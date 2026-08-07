const {
    app,
    BrowserWindow,
    ipcMain,
    clipboard
} = require("electron");

const path = require("path");

const activeStreams =
    new Map();

function createWindow() {

    const win = new BrowserWindow({

        width: 1200,
        height: 800,

        minWidth: 800,
        minHeight: 600,

        backgroundColor: "#212121",

        webPreferences: {

            preload: path.join(
                __dirname,
                "preload.js"
            ),

            contextIsolation: true,

            nodeIntegration: false

        }

    });


    win.loadFile("index.html");

}


ipcMain.on(
    "ask-ai-stream",

    async (event, data) => {

        const {
            requestId,
            conversation
        } = data;

const controller =
    new AbortController();


activeStreams.set(
    requestId,
    controller
);

        try {

            const response = await fetch(
                "http://127.0.0.1:11434/api/chat",
                {

                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    signal: controller.signal,

                    body: JSON.stringify({

    model: "llama3.2",

    messages: conversation,

    stream: true,

    options: {

        temperature: 0.9,

        top_p: 0.95,

        seed: Math.floor(
            Math.random() * 2147483647
        )

    }

})

                }
            );


            if (!response.ok) {

                throw new Error(
                    "Ollama returned error " +
                    response.status
                );

            }


            if (!response.body) {

                throw new Error(
                    "Ollama did not return a response."
                );

            }


            const reader =
                response.body.getReader();

            const decoder =
                new TextDecoder();


            let buffer = "";

            let doneSent = false;


            while (true) {

                const {
                    value,
                    done
                } = await reader.read();


                if (done) {
                    break;
                }


                buffer += decoder.decode(
                    value,
                    {
                        stream: true
                    }
                );


                const lines =
                    buffer.split("\n");


                buffer =
                    lines.pop() || "";


                for (const line of lines) {

                    if (
                        line.trim() === ""
                    ) {
                        continue;
                    }


                    const chunk =
                        JSON.parse(line);


                    if (
                        chunk.message &&
                        chunk.message.content
                    ) {

                        event.sender.send(
                            "ai-stream-chunk",
                            {
                                requestId,
                                text:
                                    chunk.message.content
                            }
                        );

                    }


                    if (chunk.done) {

                        event.sender.send(
                            "ai-stream-done",
                            {
                                requestId
                            }
                        );

                        doneSent = true;

                    }

                }

            }


            if (
                buffer.trim() !== ""
            ) {

                const chunk =
                    JSON.parse(buffer);


                if (
                    chunk.message &&
                    chunk.message.content
                ) {

                    event.sender.send(
                        "ai-stream-chunk",
                        {
                            requestId,
                            text:
                                chunk.message.content
                        }
                    );

                }


                if (chunk.done) {

                    event.sender.send(
                        "ai-stream-done",
                        {
                            requestId
                        }
                    );

                    doneSent = true;

                }

            }


            if (!doneSent) {

                event.sender.send(
                    "ai-stream-done",
                    {
                        requestId
                    }
                );

            }

        } catch (error) {

    if (
        error.name ===
        "AbortError"
    ) {

        return;

    }


    console.error(error);


    event.sender.send(
        "ai-stream-error",
        {

            requestId,

            error:
                "Couldn't connect to Ollama. " +
                error.message

        }
    );

} finally {

    activeStreams.delete(
        requestId
    );

}

    }
);

ipcMain.on(
    "stop-ai-stream",
    (
        event,
        data
    ) => {

        const {
            requestId
        } = data;


        const controller =
            activeStreams.get(
                requestId
            );


        if (!controller) {
            return;
        }


        controller.abort();


        activeStreams.delete(
            requestId
        );


        event.sender.send(
            "ai-stream-stopped",
            {
                requestId
            }
        );

    }
);

app.whenReady().then(() => {

    createWindow();


    app.on(
        "activate",
        () => {

            if (
                BrowserWindow
                    .getAllWindows()
                    .length === 0
            ) {

                createWindow();

            }

        }
    );

});


app.on(
    "window-all-closed",

    () => {

        if (
            process.platform !== "darwin"
        ) {

            app.quit();

        }

    }
);