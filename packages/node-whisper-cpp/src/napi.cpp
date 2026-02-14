#include <napi.h>
#include <whisper.h>
#include <ggml-backend.h>
#include <dlfcn.h>
#include <string>
#include <vector>

// Resolve the directory containing this .node binary at runtime via dladdr.
// Used to tell ggml where to find dynamically-loaded backend plugins
// (CPU variants, CUDA, etc.) that live alongside the addon.
static std::string get_addon_dir() {
    Dl_info info;
    if (dladdr(reinterpret_cast<void*>(get_addon_dir), &info) && info.dli_fname) {
        std::string path(info.dli_fname);
        auto pos = path.find_last_of('/');
        if (pos != std::string::npos)
            return path.substr(0, pos);
    }
    return ".";
}

// ── AsyncWorker for whisper_full (runs off the main thread) ──────────────

struct Segment {
    int64_t t0;
    int64_t t1;
    std::string text;
};

// Data passed through the ThreadSafeFunction
struct SegmentCallbackData {
    Segment segment;
};

// Callback context for whisper's new_segment_callback
struct CallbackContext {
    Napi::ThreadSafeFunction tsfn;
    struct whisper_context* ctx;
    int prev_segments; // track how many segments we've already seen
};

class TranscribeWorker : public Napi::AsyncWorker {
public:
    TranscribeWorker(
        Napi::Env env,
        Napi::Promise::Deferred deferred,
        struct whisper_context* ctx,
        std::vector<float> pcm,
        std::string language,
        int threads,
        Napi::ThreadSafeFunction tsfn
    )
        : Napi::AsyncWorker(env)
        , deferred_(deferred)
        , ctx_(ctx)
        , pcm_(std::move(pcm))
        , language_(std::move(language))
        , threads_(threads)
        , rc_(0)
        , tsfn_(std::move(tsfn))
    {}

    void Execute() override {
        struct whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        params.n_threads = threads_;
        params.print_progress = false;
        params.print_realtime = false;
        params.print_special = false;
        params.print_timestamps = false;
        params.single_segment = false;
        params.no_timestamps = false;

        if (!language_.empty() && language_ != "auto") {
            params.language = language_.c_str();
        }

        // Set up streaming callback if we have a TSFN
        CallbackContext cb_ctx;
        if (tsfn_) {
            cb_ctx.tsfn = std::move(tsfn_);
            cb_ctx.ctx = ctx_;
            cb_ctx.prev_segments = 0;

            params.new_segment_callback = [](struct whisper_context* ctx, struct whisper_state* /*state*/, int n_new, void* user_data) {
                auto* cb = static_cast<CallbackContext*>(user_data);
                int total = whisper_full_n_segments(ctx);

                for (int i = total - n_new; i < total; i++) {
                    auto* data = new SegmentCallbackData();
                    data->segment.t0 = whisper_full_get_segment_t0(ctx, i);
                    data->segment.t1 = whisper_full_get_segment_t1(ctx, i);
                    const char* txt = whisper_full_get_segment_text(ctx, i);
                    data->segment.text = txt ? txt : "";

                    cb->tsfn.NonBlockingCall(data, [](Napi::Env env, Napi::Function fn, SegmentCallbackData* data) {
                        Napi::Object seg = Napi::Object::New(env);
                        seg.Set("t0", Napi::Number::New(env, (double)data->segment.t0));
                        seg.Set("t1", Napi::Number::New(env, (double)data->segment.t1));
                        seg.Set("text", Napi::String::New(env, data->segment.text));
                        fn.Call({seg});
                        delete data;
                    });
                }
            };
            params.new_segment_callback_user_data = &cb_ctx;
        }

        rc_ = whisper_full(ctx_, params, pcm_.data(), (int)pcm_.size());
        if (rc_ != 0) {
            if (cb_ctx.tsfn) cb_ctx.tsfn.Release();
            return;
        }

        int n = whisper_full_n_segments(ctx_);
        for (int i = 0; i < n; i++) {
            Segment seg;
            seg.t0 = whisper_full_get_segment_t0(ctx_, i);
            seg.t1 = whisper_full_get_segment_t1(ctx_, i);
            const char* txt = whisper_full_get_segment_text(ctx_, i);
            seg.text = txt ? txt : "";
            segments_.push_back(std::move(seg));
        }

        if (cb_ctx.tsfn) cb_ctx.tsfn.Release();
    }

    void OnOK() override {
        Napi::Env env = Env();

        if (rc_ != 0) {
            deferred_.Reject(Napi::Error::New(env, "whisper_full failed with code " + std::to_string(rc_)).Value());
            return;
        }

        Napi::Array result = Napi::Array::New(env, segments_.size());
        for (size_t i = 0; i < segments_.size(); i++) {
            Napi::Object seg = Napi::Object::New(env);
            seg.Set("t0", Napi::Number::New(env, (double)segments_[i].t0));
            seg.Set("t1", Napi::Number::New(env, (double)segments_[i].t1));
            seg.Set("text", Napi::String::New(env, segments_[i].text));
            result.Set((uint32_t)i, seg);
        }

        deferred_.Resolve(result);
    }

    void OnError(const Napi::Error& err) override {
        deferred_.Reject(err.Value());
    }

private:
    Napi::Promise::Deferred deferred_;
    struct whisper_context* ctx_;
    std::vector<float> pcm_;
    std::string language_;
    int threads_;
    int rc_;
    std::vector<Segment> segments_;
    Napi::ThreadSafeFunction tsfn_;
};

// ── Wrapped WhisperContext ────────────────────────────────────────────────

class WhisperContextWrap : public Napi::ObjectWrap<WhisperContextWrap> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "WhisperContext", {
            InstanceMethod("transcribe", &WhisperContextWrap::Transcribe),
            InstanceMethod("free", &WhisperContextWrap::Free),
        });

        Napi::FunctionReference* ctor = new Napi::FunctionReference();
        *ctor = Napi::Persistent(func);
        env.SetInstanceData(ctor);

        exports.Set("WhisperContext", func);
        return exports;
    }

    WhisperContextWrap(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<WhisperContextWrap>(info)
        , ctx_(nullptr)
    {
        Napi::Env env = info.Env();

        if (info.Length() < 1 || !info[0].IsObject()) {
            Napi::TypeError::New(env, "Expected options object").ThrowAsJavaScriptException();
            return;
        }

        Napi::Object opts = info[0].As<Napi::Object>();

        if (!opts.Has("model") || !opts.Get("model").IsString()) {
            Napi::TypeError::New(env, "options.model must be a string").ThrowAsJavaScriptException();
            return;
        }

        std::string model = opts.Get("model").As<Napi::String>().Utf8Value();

        struct whisper_context_params cparams = whisper_context_default_params();

        if (opts.Has("use_gpu") && opts.Get("use_gpu").IsBoolean()) {
            cparams.use_gpu = opts.Get("use_gpu").As<Napi::Boolean>().Value();
        }

        if (opts.Has("flash_attn") && opts.Get("flash_attn").IsBoolean()) {
            cparams.flash_attn = opts.Get("flash_attn").As<Napi::Boolean>().Value();
        }

        if (opts.Has("gpu_device") && opts.Get("gpu_device").IsNumber()) {
            cparams.gpu_device = opts.Get("gpu_device").As<Napi::Number>().Int32Value();
        }

        ctx_ = whisper_init_from_file_with_params(model.c_str(), cparams);
        if (!ctx_) {
            Napi::Error::New(env, "Failed to load whisper model: " + model).ThrowAsJavaScriptException();
            return;
        }
    }

    ~WhisperContextWrap() {
        if (ctx_) {
            whisper_free(ctx_);
            ctx_ = nullptr;
        }
    }

private:
    Napi::Value Transcribe(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (!ctx_) {
            Napi::Error::New(env, "Context has been freed").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        if (info.Length() < 1 || !info[0].IsObject()) {
            Napi::TypeError::New(env, "Expected options object").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        Napi::Object opts = info[0].As<Napi::Object>();

        // PCM samples: Float32Array
        if (!opts.Has("pcm") || !opts.Get("pcm").IsTypedArray()) {
            Napi::TypeError::New(env, "options.pcm must be a Float32Array").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        Napi::Float32Array pcmArr = opts.Get("pcm").As<Napi::Float32Array>();
        std::vector<float> pcm(pcmArr.Data(), pcmArr.Data() + pcmArr.ElementLength());

        // Language
        std::string language = "en";
        if (opts.Has("language") && opts.Get("language").IsString()) {
            language = opts.Get("language").As<Napi::String>().Utf8Value();
        }

        // Threads
        int threads = 4;
        if (opts.Has("threads") && opts.Get("threads").IsNumber()) {
            threads = opts.Get("threads").As<Napi::Number>().Int32Value();
        }

        // onSegment callback (optional)
        Napi::ThreadSafeFunction tsfn;
        if (opts.Has("onSegment") && opts.Get("onSegment").IsFunction()) {
            Napi::Function cb = opts.Get("onSegment").As<Napi::Function>();
            tsfn = Napi::ThreadSafeFunction::New(
                env,
                cb,
                "whisper_segment_callback",
                0,  // unlimited queue
                1   // one thread
            );
        }

        Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
        auto worker = new TranscribeWorker(env, deferred, ctx_, std::move(pcm), std::move(language), threads, std::move(tsfn));
        worker->Queue();

        return deferred.Promise();
    }

    Napi::Value Free(const Napi::CallbackInfo& info) {
        if (ctx_) {
            whisper_free(ctx_);
            ctx_ = nullptr;
        }
        return info.Env().Undefined();
    }

    struct whisper_context* ctx_;
};

// ── Module entry ─────────────────────────────────────────────────────────

Napi::Value GetVersion(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), whisper_version());
}

Napi::Value GetSystemInfo(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), whisper_print_system_info());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Load ggml backend plugins (CPU variants, CUDA, etc.) from the directory
    // containing this .node file. Required for GGML_BACKEND_DL builds where
    // backends are separate .so files rather than statically linked.
    std::string dir = get_addon_dir();
    ggml_backend_load_all_from_path(dir.c_str());

    WhisperContextWrap::Init(env, exports);
    exports.Set("version", Napi::Function::New(env, GetVersion));
    exports.Set("systemInfo", Napi::Function::New(env, GetSystemInfo));
    return exports;
}

NODE_API_MODULE(whisper_addon, Init)
