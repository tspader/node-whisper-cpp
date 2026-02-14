cmake_minimum_required(VERSION 3.15)
project(whisper-addon C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Platform triple (e.g. arm64-apple-darwin-metal)
if(NOT DEFINED WHISPER_TRIPLE)
    message(FATAL_ERROR "WHISPER_TRIPLE must be set (e.g. arm64-apple-darwin-metal)")
endif()

set(STORE_DIR "${CMAKE_SOURCE_DIR}/.cache/store/whisper.cpp/${WHISPER_TRIPLE}")
set(WHISPER_INCLUDE "${STORE_DIR}/include")
set(WHISPER_LIB "${STORE_DIR}/lib")
set(WHISPER_BIN "${STORE_DIR}/bin")

# rpath: look for dylibs next to the .node file
if(APPLE)
    set(CMAKE_SKIP_BUILD_RPATH FALSE)
    set(CMAKE_INSTALL_RPATH_USE_LINK_PATH FALSE)
    set(CMAKE_BUILD_RPATH "@loader_path")
    set(CMAKE_INSTALL_RPATH "@loader_path")
    set(CMAKE_BUILD_WITH_INSTALL_RPATH TRUE)
else()
    set(CMAKE_BUILD_RPATH_USE_ORIGIN ON)
    if(CMAKE_SYSTEM_NAME MATCHES "Linux" OR CMAKE_SYSTEM_NAME MATCHES "Android")
        set(CMAKE_SKIP_BUILD_RPATH FALSE)
        set(CMAKE_INSTALL_RPATH_USE_LINK_PATH FALSE)
        set(CMAKE_BUILD_RPATH "$ORIGIN")
        set(CMAKE_INSTALL_RPATH "$ORIGIN")
        set(CMAKE_BUILD_WITH_INSTALL_RPATH FALSE)
    endif()
endif()

# N-API
add_definitions(-DNAPI_VERSION=8)
execute_process(
    COMMAND node -p "require('node-addon-api').include.slice(1,-1)"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
include_directories(${NODE_ADDON_API_DIR} ${CMAKE_JS_INC})

# Whisper headers + libs
include_directories(${WHISPER_INCLUDE})
link_directories(${WHISPER_LIB})

# Build the addon
set(ADDON_SOURCES "packages/node-whisper-cpp/src/napi.cpp")
add_library(${PROJECT_NAME} SHARED ${ADDON_SOURCES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")
target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB} whisper ggml ${CMAKE_DL_LIBS})

# Copy dylibs next to the .node output so rpath resolves
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory ${WHISPER_LIB} $<TARGET_FILE_DIR:${PROJECT_NAME}>
    COMMENT "Copying whisper libs to build output"
)

# Copy dynamically-loaded backend plugins (from GGML_BACKEND_DL builds) next to the .node output
if(EXISTS "${WHISPER_BIN}")
    add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory ${WHISPER_BIN} $<TARGET_FILE_DIR:${PROJECT_NAME}>
        COMMENT "Copying whisper backend plugins to build output"
    )
endif()

# Install addon + runtime libs into a package bins directory
install(TARGETS ${PROJECT_NAME}
    LIBRARY DESTINATION .
    RUNTIME DESTINATION .
)

install(DIRECTORY ${WHISPER_LIB}/
    DESTINATION .
    FILES_MATCHING
    PATTERN "*.dylib"
    PATTERN "*.so"
    PATTERN "*.so.*"
    PATTERN "*.dll"
)

# Install dynamically-loaded backend plugins (CPU variants, CUDA, etc.)
if(EXISTS "${WHISPER_BIN}")
    install(DIRECTORY ${WHISPER_BIN}/
        DESTINATION .
        FILES_MATCHING
        PATTERN "*.dylib"
        PATTERN "*.so"
        PATTERN "*.so.*"
        PATTERN "*.dll"
    )
endif()
