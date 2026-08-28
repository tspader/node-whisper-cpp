#include <napi.h>
#include <whisper.h>
#include <ggml-backend.h>
#include <dlfcn.h>
#include <atomic>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

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

// ── Parsed transcription options ─────────────────────────────────────────

struct Options {
    std::vector<float> pcm;
    std::optional<std::string> language;
    std::optional<bool> translate;
    std::optional<int> threads;
    std::optional<std::string> prompt;
    std::optional<int> offsetMs;
    std::optional<int> durationMs;
    std::optional<int> maxLen;
    std::optional<bool> splitOnWord;
    std::optional<int> maxTokens;
    std::optional<bool> tokenTimestamps;
    std::optional<bool> diarize;
    std::optional<double> temperature;
    std::optional<double> temperatureInc;
    std::optional<int> beamSize;
    std::optional<int> bestOf;
    std::optional<double> noSpeechThreshold;
    std::optional<double> entropyThreshold;
    std::optional<double> logProbThreshold;
    std::optional<bool> suppressBlank;
    std::optional<bool> suppressNonSpeech;
    std::optional<bool> vad;
    std::optional<std::string> vadModel;
    std::optional<double> vadThreshold;
    std::optional<int> vadMinSpeechMs;
    std::optional<int> vadMinSilenceMs;
    std::optional<double> vadMaxSpeechSeconds;
    std::optional<int> vadSpeechPadMs;
    std::optional<double> vadSamplesOverlap;
};

static std::optional<bool> opt_bool(Napi::Object o, const char* key) {
    if (o.Has(key) && o.Get(key).IsBoolean()) return o.Get(key).As<Napi::Boolean>().Value();
    return std::nullopt;
}

static std::optional<int> opt_int(Napi::Object o, const char* key) {
    if (o.Has(key) && o.Get(key).IsNumber()) return o.Get(key).As<Napi::Number>().Int32Value();
    return std::nullopt;
}

static std::optional<double> opt_num(Napi::Object o, const char* key) {
    if (o.Has(key) && o.Get(key).IsNumber()) return o.Get(key).As<Napi::Number>().DoubleValue();
    return std::nullopt;
}

static std::optional<std::string> opt_str(Napi::Object o, const char* key) {
    if (o.Has(key) && o.Get(key).IsString()) return o.Get(key).As<Napi::String>().Utf8Value();
    return std::nullopt;
}

// ── Snapshots read off the whisper state on the compute thread ───────────

struct TokenOut {
    std::string text;
    int64_t t0;
    int64_t t1;
    float p;
};

struct SegmentOut {
    std::string text;
    int64_t t0;
    int64_t t1;
    float noSpeech;
    bool speaker;
    bool hasSpeaker;
    std::vector<TokenOut> tokens;
    bool hasTokens;
};

struct Reader {
    whisper_context* ctx;
    whisper_state* state;

    int nSegments() const {
        return state ? whisper_full_n_segments_from_state(state) : whisper_full_n_segments(ctx);
    }
    int64_t t0(int i) const {
        return state ? whisper_full_get_segment_t0_from_state(state, i) : whisper_full_get_segment_t0(ctx, i);
    }
    int64_t t1(int i) const {
        return state ? whisper_full_get_segment_t1_from_state(state, i) : whisper_full_get_segment_t1(ctx, i);
    }
    const char* text(int i) const {
        return state ? whisper_full_get_segment_text_from_state(state, i) : whisper_full_get_segment_text(ctx, i);
    }
    float noSpeech(int i) const {
        return state ? whisper_full_get_segment_no_speech_prob_from_state(state, i)
                     : whisper_full_get_segment_no_speech_prob(ctx, i);
    }
    bool speaker(int i) const {
        return state ? whisper_full_get_segment_speaker_turn_next_from_state(state, i)
                     : whisper_full_get_segment_speaker_turn_next(ctx, i);
    }
    int nTokens(int i) const {
        return state ? whisper_full_n_tokens_from_state(state, i) : whisper_full_n_tokens(ctx, i);
    }
    const char* tokenText(int i, int j) const {
        return state ? whisper_full_get_token_text_from_state(ctx, state, i, j)
                     : whisper_full_get_token_text(ctx, i, j);
    }
    whisper_token_data tokenData(int i, int j) const {
        return state ? whisper_full_get_token_data_from_state(state, i, j) : whisper_full_get_token_data(ctx, i, j);
    }
    int langId() const {
        return state ? whisper_full_lang_id_from_state(state) : whisper_full_lang_id(ctx);
    }
};

static SegmentOut snapshot(const Reader& reader, int i, bool emitTokens, bool emitSpeaker) {
    SegmentOut out;
    const char* text = reader.text(i);
    out.text = text ? text : "";
    out.t0 = reader.t0(i);
    out.t1 = reader.t1(i);
    out.noSpeech = reader.noSpeech(i);
    out.hasSpeaker = emitSpeaker;
    out.speaker = emitSpeaker ? reader.speaker(i) : false;
    out.hasTokens = emitTokens;
    if (emitTokens) {
        int n = reader.nTokens(i);
        out.tokens.reserve(n);
        for (int j = 0; j < n; j++) {
            whisper_token_data data = reader.tokenData(i, j);
            const char* tt = reader.tokenText(i, j);
            out.tokens.push_back(TokenOut{ tt ? tt : "", data.t0, data.t1, data.p });
        }
    }
    return out;
}

static Napi::Value segment_value(Napi::Env env, const SegmentOut& seg) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("text", Napi::String::New(env, seg.text));
    obj.Set("t0", Napi::Number::New(env, (double)seg.t0));
    obj.Set("t1", Napi::Number::New(env, (double)seg.t1));
    obj.Set("noSpeechProb", Napi::Number::New(env, seg.noSpeech));
    if (seg.hasSpeaker) obj.Set("speakerTurn", Napi::Boolean::New(env, seg.speaker));
    if (seg.hasTokens) {
        Napi::Array tokens = Napi::Array::New(env, seg.tokens.size());
        for (size_t j = 0; j < seg.tokens.size(); j++) {
            const TokenOut& tok = seg.tokens[j];
            Napi::Object t = Napi::Object::New(env);
            t.Set("text", Napi::String::New(env, tok.text));
            t.Set("t0", Napi::Number::New(env, (double)tok.t0));
            t.Set("t1", Napi::Number::New(env, (double)tok.t1));
            t.Set("p", Napi::Number::New(env, tok.p));
            tokens.Set((uint32_t)j, t);
        }
        obj.Set("tokens", tokens);
    }
    return obj;
}

// ── Async worker ─────────────────────────────────────────────────────────

class TranscribeWorker : public Napi::AsyncWorker {
public:
    TranscribeWorker(
        Napi::Env env,
        Napi::Promise::Deferred deferred,
        whisper_context* ctx,
        whisper_state* state,
        Options options,
        Napi::ThreadSafeFunction segmentTsfn,
        Napi::ThreadSafeFunction progressTsfn,
        int32_t* abort,
        Napi::Reference<Napi::Int32Array> abortRef
    )
        : Napi::AsyncWorker(env)
        , deferred_(deferred)
        , ctx_(ctx)
        , state_(state)
        , options_(std::move(options))
        , segmentTsfn_(std::move(segmentTsfn))
        , progressTsfn_(std::move(progressTsfn))
        , abort_(abort)
        , abortRef_(std::move(abortRef))
        , emitTokens_(options_.tokenTimestamps.value_or(false))
        , emitSpeaker_(options_.diarize.value_or(false))
        , rc_(0)
    {}

    void Execute() override {
        bool beam = options_.beamSize && *options_.beamSize > 0;
        whisper_full_params params = whisper_full_default_params(beam ? WHISPER_SAMPLING_BEAM_SEARCH : WHISPER_SAMPLING_GREEDY);
        params.print_progress = false;
        params.print_realtime = false;
        params.print_special = false;
        params.print_timestamps = false;

        if (options_.threads) params.n_threads = *options_.threads;
        if (options_.translate) params.translate = *options_.translate;
        if (options_.offsetMs) params.offset_ms = *options_.offsetMs;
        if (options_.durationMs) params.duration_ms = *options_.durationMs;
        if (options_.maxLen) params.max_len = *options_.maxLen;
        if (options_.splitOnWord) params.split_on_word = *options_.splitOnWord;
        if (options_.maxTokens) params.max_tokens = *options_.maxTokens;
        if (emitTokens_) params.token_timestamps = true;
        if (emitSpeaker_) params.tdrz_enable = true;
        if (options_.temperature) params.temperature = (float)*options_.temperature;
        if (options_.temperatureInc) params.temperature_inc = (float)*options_.temperatureInc;
        if (options_.beamSize) params.beam_search.beam_size = *options_.beamSize;
        if (options_.bestOf) params.greedy.best_of = *options_.bestOf;
        if (options_.noSpeechThreshold) params.no_speech_thold = (float)*options_.noSpeechThreshold;
        if (options_.entropyThreshold) params.entropy_thold = (float)*options_.entropyThreshold;
        if (options_.logProbThreshold) params.logprob_thold = (float)*options_.logProbThreshold;
        if (options_.suppressBlank) params.suppress_blank = *options_.suppressBlank;
        if (options_.suppressNonSpeech) params.suppress_nst = *options_.suppressNonSpeech;

        std::string language = options_.language.value_or("auto");
        if (language.empty() || language == "auto") {
            params.language = nullptr;
        } else {
            params.language = language.c_str();
        }

        std::string prompt;
        if (options_.prompt) {
            prompt = *options_.prompt;
            params.initial_prompt = prompt.c_str();
        }

        std::string vadModel;
        if (options_.vad.value_or(false)) {
            params.vad = true;
            if (options_.vadModel) {
                vadModel = *options_.vadModel;
                params.vad_model_path = vadModel.c_str();
            }
            if (options_.vadThreshold) params.vad_params.threshold = (float)*options_.vadThreshold;
            if (options_.vadMinSpeechMs) params.vad_params.min_speech_duration_ms = *options_.vadMinSpeechMs;
            if (options_.vadMinSilenceMs) params.vad_params.min_silence_duration_ms = *options_.vadMinSilenceMs;
            if (options_.vadMaxSpeechSeconds) params.vad_params.max_speech_duration_s = (float)*options_.vadMaxSpeechSeconds;
            if (options_.vadSpeechPadMs) params.vad_params.speech_pad_ms = *options_.vadSpeechPadMs;
            if (options_.vadSamplesOverlap) params.vad_params.samples_overlap = (float)*options_.vadSamplesOverlap;
        }

        if (abort_) {
            params.abort_callback = [](void* ud) -> bool {
                return ud && *reinterpret_cast<volatile int32_t*>(ud) != 0;
            };
            params.abort_callback_user_data = abort_;
        }

        if (progressTsfn_) {
            params.progress_callback = [](struct whisper_context*, struct whisper_state*, int progress, void* ud) {
                auto* tsfn = static_cast<Napi::ThreadSafeFunction*>(ud);
                double fraction = progress / 100.0;
                tsfn->NonBlockingCall([fraction](Napi::Env env, Napi::Function fn) {
                    fn.Call({ Napi::Number::New(env, fraction) });
                });
            };
            params.progress_callback_user_data = &progressTsfn_;
        }

        if (segmentTsfn_) {
            params.new_segment_callback = [](struct whisper_context* ctx, struct whisper_state* state, int n_new, void* ud) {
                auto* self = static_cast<TranscribeWorker*>(ud);
                Reader reader{ ctx, state };
                int total = reader.nSegments();
                for (int i = total - n_new; i < total; i++) {
                    SegmentOut seg = snapshot(reader, i, self->emitTokens_, self->emitSpeaker_);
                    self->segmentTsfn_.NonBlockingCall([seg](Napi::Env env, Napi::Function fn) {
                        fn.Call({ segment_value(env, seg) });
                    });
                }
            };
            params.new_segment_callback_user_data = this;
        }

        rc_ = state_
            ? whisper_full_with_state(ctx_, state_, params, options_.pcm.data(), (int)options_.pcm.size())
            : whisper_full(ctx_, params, options_.pcm.data(), (int)options_.pcm.size());

        if (segmentTsfn_) segmentTsfn_.Release();
        if (progressTsfn_) progressTsfn_.Release();

        if (rc_ != 0) return;

        Reader reader{ ctx_, state_ };
        int n = reader.nSegments();
        segments_.reserve(n);
        for (int i = 0; i < n; i++) {
            segments_.push_back(snapshot(reader, i, emitTokens_, emitSpeaker_));
        }

        int lang = reader.langId();
        const char* langStr = whisper_lang_str(lang);
        language_ = langStr ? langStr : "";
    }

    void OnOK() override {
        Napi::Env env = Env();
        abortRef_.Reset();

        if (rc_ != 0) {
            deferred_.Reject(Napi::Error::New(env, "whisper_full failed with code " + std::to_string(rc_)).Value());
            return;
        }

        Napi::Array segments = Napi::Array::New(env, segments_.size());
        for (size_t i = 0; i < segments_.size(); i++) {
            segments.Set((uint32_t)i, segment_value(env, segments_[i]));
        }

        Napi::Object result = Napi::Object::New(env);
        result.Set("language", Napi::String::New(env, language_));
        result.Set("segments", segments);
        deferred_.Resolve(result);
    }

    void OnError(const Napi::Error& err) override {
        abortRef_.Reset();
        deferred_.Reject(err.Value());
    }

private:
    Napi::Promise::Deferred deferred_;
    whisper_context* ctx_;
    whisper_state* state_;
    Options options_;
    Napi::ThreadSafeFunction segmentTsfn_;
    Napi::ThreadSafeFunction progressTsfn_;
    int32_t* abort_;
    Napi::Reference<Napi::Int32Array> abortRef_;
    bool emitTokens_;
    bool emitSpeaker_;
    int rc_;
    std::vector<SegmentOut> segments_;
    std::string language_;
};

// ── Shared transcribe entry used by context and state wraps ──────────────

static Napi::Value start_transcribe(const Napi::CallbackInfo& info, whisper_context* ctx, whisper_state* state) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected options object").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object opts = info[0].As<Napi::Object>();

    if (!opts.Has("pcm") || !opts.Get("pcm").IsTypedArray()) {
        Napi::TypeError::New(env, "options.pcm must be a Float32Array").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Float32Array pcm = opts.Get("pcm").As<Napi::Float32Array>();

    Options options;
    options.pcm = std::vector<float>(pcm.Data(), pcm.Data() + pcm.ElementLength());
    options.language = opt_str(opts, "language");
    options.translate = opt_bool(opts, "translate");
    options.threads = opt_int(opts, "threads");
    options.prompt = opt_str(opts, "prompt");
    options.offsetMs = opt_int(opts, "offsetMs");
    options.durationMs = opt_int(opts, "durationMs");
    options.maxLen = opt_int(opts, "maxLen");
    options.splitOnWord = opt_bool(opts, "splitOnWord");
    options.maxTokens = opt_int(opts, "maxTokens");
    options.tokenTimestamps = opt_bool(opts, "tokenTimestamps");
    options.diarize = opt_bool(opts, "diarize");
    options.temperature = opt_num(opts, "temperature");
    options.temperatureInc = opt_num(opts, "temperatureInc");
    options.beamSize = opt_int(opts, "beamSize");
    options.bestOf = opt_int(opts, "bestOf");
    options.noSpeechThreshold = opt_num(opts, "noSpeechThreshold");
    options.entropyThreshold = opt_num(opts, "entropyThreshold");
    options.logProbThreshold = opt_num(opts, "logProbThreshold");
    options.suppressBlank = opt_bool(opts, "suppressBlank");
    options.suppressNonSpeech = opt_bool(opts, "suppressNonSpeech");
    options.vad = opt_bool(opts, "vad");
    options.vadModel = opt_str(opts, "vadModel");
    options.vadThreshold = opt_num(opts, "vadThreshold");
    options.vadMinSpeechMs = opt_int(opts, "vadMinSpeechMs");
    options.vadMinSilenceMs = opt_int(opts, "vadMinSilenceMs");
    options.vadMaxSpeechSeconds = opt_num(opts, "vadMaxSpeechSeconds");
    options.vadSpeechPadMs = opt_int(opts, "vadSpeechPadMs");
    options.vadSamplesOverlap = opt_num(opts, "vadSamplesOverlap");

    Napi::ThreadSafeFunction segmentTsfn;
    if (opts.Has("onSegment") && opts.Get("onSegment").IsFunction()) {
        segmentTsfn = Napi::ThreadSafeFunction::New(env, opts.Get("onSegment").As<Napi::Function>(), "whisper_on_segment", 0, 1);
    }

    Napi::ThreadSafeFunction progressTsfn;
    if (opts.Has("onProgress") && opts.Get("onProgress").IsFunction()) {
        progressTsfn = Napi::ThreadSafeFunction::New(env, opts.Get("onProgress").As<Napi::Function>(), "whisper_on_progress", 0, 1);
    }

    int32_t* abort = nullptr;
    Napi::Reference<Napi::Int32Array> abortRef;
    if (opts.Has("abort") && opts.Get("abort").IsTypedArray()) {
        Napi::Int32Array arr = opts.Get("abort").As<Napi::Int32Array>();
        abort = arr.Data();
        abortRef = Napi::Persistent(arr);
    }

    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    auto worker = new TranscribeWorker(env, deferred, ctx, state, std::move(options), std::move(segmentTsfn), std::move(progressTsfn), abort, std::move(abortRef));
    worker->Queue();
    return deferred.Promise();
}

// ── WhisperState wrap (owns a whisper_state) ─────────────────────────────

class WhisperStateWrap : public Napi::ObjectWrap<WhisperStateWrap> {
public:
    static Napi::FunctionReference Define(Napi::Env env) {
        Napi::Function func = DefineClass(env, "WhisperState", {
            InstanceMethod("transcribe", &WhisperStateWrap::Transcribe),
            InstanceMethod("free", &WhisperStateWrap::Free),
        });
        return Napi::Persistent(func);
    }

    WhisperStateWrap(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<WhisperStateWrap>(info)
        , ctx_(nullptr)
        , state_(nullptr)
    {
        ctx_ = static_cast<whisper_context*>(info[0].As<Napi::External<whisper_context>>().Data());
        state_ = static_cast<whisper_state*>(info[1].As<Napi::External<whisper_state>>().Data());
    }

    ~WhisperStateWrap() {
        if (state_) {
            whisper_free_state(state_);
            state_ = nullptr;
        }
    }

private:
    Napi::Value Transcribe(const Napi::CallbackInfo& info) {
        if (!state_) {
            Napi::Error::New(info.Env(), "Session has been freed").ThrowAsJavaScriptException();
            return info.Env().Undefined();
        }
        return start_transcribe(info, ctx_, state_);
    }

    Napi::Value Free(const Napi::CallbackInfo& info) {
        if (state_) {
            whisper_free_state(state_);
            state_ = nullptr;
        }
        return info.Env().Undefined();
    }

    whisper_context* ctx_;
    whisper_state* state_;
};

// ── WhisperContext wrap (owns the model) ─────────────────────────────────

struct AddonData {
    Napi::FunctionReference stateCtor;
};

class WhisperContextWrap : public Napi::ObjectWrap<WhisperContextWrap> {
public:
    static Napi::Function Define(Napi::Env env) {
        return DefineClass(env, "WhisperContext", {
            InstanceMethod("transcribe", &WhisperContextWrap::Transcribe),
            InstanceMethod("createState", &WhisperContextWrap::CreateState),
            InstanceMethod("modelInfo", &WhisperContextWrap::ModelInfo),
            InstanceMethod("free", &WhisperContextWrap::Free),
        });
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

        whisper_context_params cparams = whisper_context_default_params();
        if (auto v = opt_bool(opts, "useGpu")) cparams.use_gpu = *v;
        if (auto v = opt_bool(opts, "flashAttn")) cparams.flash_attn = *v;
        if (auto v = opt_int(opts, "gpuDevice")) cparams.gpu_device = *v;

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
        if (!ctx_) {
            Napi::Error::New(info.Env(), "Model has been freed").ThrowAsJavaScriptException();
            return info.Env().Undefined();
        }
        return start_transcribe(info, ctx_, nullptr);
    }

    Napi::Value CreateState(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!ctx_) {
            Napi::Error::New(env, "Model has been freed").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        whisper_state* state = whisper_init_state(ctx_);
        if (!state) {
            Napi::Error::New(env, "Failed to create whisper state").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        auto* data = env.GetInstanceData<AddonData>();
        return data->stateCtor.New({
            Napi::External<whisper_context>::New(env, ctx_),
            Napi::External<whisper_state>::New(env, state),
        });
    }

    Napi::Value ModelInfo(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!ctx_) {
            Napi::Error::New(env, "Model has been freed").ThrowAsJavaScriptException();
            return env.Undefined();
        }

        const char* type = whisper_model_type_readable(ctx_);
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("type", Napi::String::New(env, type ? type : ""));
        obj.Set("multilingual", Napi::Boolean::New(env, whisper_is_multilingual(ctx_) != 0));
        obj.Set("vocabSize", Napi::Number::New(env, whisper_model_n_vocab(ctx_)));
        obj.Set("audioContextSize", Napi::Number::New(env, whisper_model_n_audio_ctx(ctx_)));
        obj.Set("textContextSize", Napi::Number::New(env, whisper_model_n_text_ctx(ctx_)));
        return obj;
    }

    Napi::Value Free(const Napi::CallbackInfo& info) {
        if (ctx_) {
            whisper_free(ctx_);
            ctx_ = nullptr;
        }
        return info.Env().Undefined();
    }

    whisper_context* ctx_;
};

// ── Module entry ─────────────────────────────────────────────────────────

Napi::Value GetVersion(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), whisper_version());
}

Napi::Value GetSystemInfo(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), whisper_print_system_info());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    std::string dir = get_addon_dir();
    ggml_backend_load_all_from_path(dir.c_str());

    auto* data = new AddonData();
    data->stateCtor = WhisperStateWrap::Define(env);
    env.SetInstanceData(data);

    exports.Set("WhisperContext", WhisperContextWrap::Define(env));
    exports.Set("version", Napi::Function::New(env, GetVersion));
    exports.Set("systemInfo", Napi::Function::New(env, GetSystemInfo));
    return exports;
}

NODE_API_MODULE(whisper_addon, Init)
