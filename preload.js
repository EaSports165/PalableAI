const {
    contextBridge,
    ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld(
    "myAI",
    {

    buildCSharpExe: (
    filename,
    content
) => {

    return ipcRenderer.invoke(
        "build-csharp-exe",
        {
            filename,
            content
        }
    );

},
    
    buildPythonExe: (
    filename,
    content
) => {

    return ipcRenderer.invoke(
        "build-python-exe",
        {
            filename,
            content
        }
    );

},

        getModes: () => {
    return ipcRenderer.invoke(
        "get-modes"
    );
},


        askStream: (
            requestId,
            conversation,
            mode
        ) => {

            ipcRenderer.send(
                "ask-ai-stream",
                {
                    requestId,
                    conversation,
                    mode
                }
            );

        },


        stopStream: (
            requestId
        ) => {

            ipcRenderer.send(
                "stop-ai-stream",
                {
                    requestId
                }
            );

        },


        onChunk: (
            callback
        ) => {

            ipcRenderer.on(
                "ai-stream-chunk",
                (
                    event,
                    data
                ) => callback(data)
            );

        },


        onDone: (
            callback
        ) => {

            ipcRenderer.on(
                "ai-stream-done",
                (
                    event,
                    data
                ) => callback(data)
            );

        },


        onStopped: (
            callback
        ) => {

            ipcRenderer.on(
                "ai-stream-stopped",
                (
                    event,
                    data
                ) => callback(data)
            );

        },


        onError: (
            callback
        ) => {

            ipcRenderer.on(
                "ai-stream-error",
                (
                    event,
                    data
                ) => callback(data)
            );

        },


        copyText: (
            text
        ) => {

            return ipcRenderer.invoke(
                "copy-text",
                text
            );

        },

        saveTextFile: (
    filename,
    content
) => {

    return ipcRenderer.invoke(
        "save-text-file",
        {
            filename,
            content
        }
    );

},


    }
);