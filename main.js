const {
    app,
    BrowserWindow,
    ipcMain,
    clipboard,
    dialog
} = require("electron");

const path = require("path");

const modes =
    require("./modes.json");

const fs =
    require("fs");

const os =
    require("os");

const {
    spawn
} = require("child_process");

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
    conversation,
    mode
} = data;

const selectedMode =
    modes[mode] ||
    modes.general;

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

    messages: [

    {
        role: "system",

        content:
            selectedMode.systemPrompt
    },

    ...conversation

],

    stream: true,

    options: {

    temperature:
        selectedMode.temperature,

    top_p:
        selectedMode.topP,

    num_predict:
        selectedMode.numPredict,

    seed:
        Math.floor(
            Math.random() *
            2147483647
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

ipcMain.handle(
    "get-modes",
    () => {

        return modes;

    }
);

ipcMain.handle(
    "copy-text",
    (
        event,
        text
    ) => {

        clipboard.writeText(
            text
        );

        return true;

    }
);

ipcMain.handle(
    "save-text-file",

    async (
        event,
        data
    ) => {

        try {

            const {
                filename,
                content
            } = data;


            const result =
                await dialog.showSaveDialog(
                    {
                        defaultPath:
                            filename,

                        properties: [
                            "createDirectory",
                            "showOverwriteConfirmation"
                        ]
                    }
                );


            if (
                result.canceled ||
                !result.filePath
            ) {

                return {
                    success: false,
                    canceled: true
                };

            }


            fs.writeFileSync(
                result.filePath,
                content,
                "utf8"
            );


            return {
                success: true,
                path: result.filePath
            };


        } catch (error) {

            console.error(
                "File save failed:",
                error
            );


            return {
                success: false,
                canceled: false,
                error: error.message
            };

        }

    }
);

ipcMain.handle(
    "build-python-exe",

    async (
        event,
        data
    ) => {

        const {
            filename,
            content
        } = data;


        try {

            /*
                =========================
                CREATE TEMP BUILD FOLDER
                =========================
            */

            const buildRoot =
                fs.mkdtempSync(
                    path.join(
                        os.tmpdir(),
                        "PalableAI-Build-"
                    )
                );


            /*
                Make sure the source file
                ends in .py
            */

            let pythonFilename =
                filename || "PalableAI_App.py";


            if (
                !pythonFilename
                    .toLowerCase()
                    .endsWith(".py")
            ) {

                pythonFilename +=
                    ".py";

            }


            /*
                Remove characters Windows
                doesn't allow in filenames.
            */

            pythonFilename =
                pythonFilename.replace(
                    /[<>:"/\\|?*]/g,
                    "_"
                );


            const sourcePath =
                path.join(
                    buildRoot,
                    pythonFilename
                );


            fs.writeFileSync(
                sourcePath,
                content,
                "utf8"
            );


            /*
                =========================
                OUTPUT NAME
                =========================
            */

            const appName =
                path.basename(
                    pythonFilename,
                    ".py"
                );


            /*
                =========================
                GUI DETECTION
                =========================

                If it looks like a GUI app,
                hide the console window.
            */

            const lowerCode =
                content.toLowerCase();


            const looksLikeGUI =
                lowerCode.includes(
                    "import tkinter"
                ) ||

                lowerCode.includes(
                    "from tkinter"
                ) ||

                lowerCode.includes(
                    "import customtkinter"
                ) ||

                lowerCode.includes(
                    "pyqt"
                ) ||

                lowerCode.includes(
                    "pyside"
                ) ||

                lowerCode.includes(
                    "import wx"
                );


            /*
                =========================
                PYINSTALLER ARGUMENTS
                =========================
            */

            const args = [

                "-m",
                "PyInstaller",

                "--onefile",

                "--noconfirm",

                "--clean",

                "--name",
                appName

            ];


            if (looksLikeGUI) {

                args.push(
                    "--windowed"
                );

            }


            args.push(
                sourcePath
            );


            /*
                =========================
                BUILD
                =========================
            */

            const buildResult =
                await new Promise(
                    (
                        resolve,
                        reject
                    ) => {

                        const process =
                            spawn(
                                "python",
                                args,
                                {
                                    cwd:
                                        buildRoot,

                                    windowsHide:
                                        true
                                }
                            );


                        let output =
                            "";

                        let errorOutput =
                            "";


                        process.stdout.on(
                            "data",
                            chunk => {

                                output +=
                                    chunk.toString();

                            }
                        );


                        process.stderr.on(
                            "data",
                            chunk => {

                                errorOutput +=
                                    chunk.toString();

                            }
                        );


                        process.on(
                            "error",
                            error => {

                                reject(
                                    error
                                );

                            }
                        );


                        process.on(
                            "close",
                            code => {

                                if (
                                    code === 0
                                ) {

                                    resolve({
                                        output,
                                        errorOutput
                                    });

                                } else {

                                    reject(
                                        new Error(
                                            errorOutput ||
                                            output ||
                                            "PyInstaller failed."
                                        )
                                    );

                                }

                            }
                        );

                    }
                );


            /*
                =========================
                FIND BUILT EXE
                =========================
            */

            const builtExe =
                path.join(
                    buildRoot,
                    "dist",
                    appName + ".exe"
                );


            if (
                !fs.existsSync(
                    builtExe
                )
            ) {

                throw new Error(
                    "The build completed, but PalableAI could not find the generated EXE."
                );

            }


            /*
                =========================
                ASK USER WHERE TO SAVE
                =========================
            */

            const saveResult =
                await dialog.showSaveDialog(
                    {
                        title:
                            "Save Built Application",

                        defaultPath:
                            appName +
                            ".exe",

                        filters: [

                            {
                                name:
                                    "Windows Application",

                                extensions: [
                                    "exe"
                                ]
                            }

                        ]
                    }
                );


            if (
                saveResult.canceled ||
                !saveResult.filePath
            ) {

                return {

                    success:
                        false,

                    canceled:
                        true

                };

            }


            /*
                Copy the finished EXE
                to wherever the user picked.
            */

            fs.copyFileSync(
                builtExe,
                saveResult.filePath
            );


            /*
                Cleanup temporary files.
            */

            try {

                fs.rmSync(
                    buildRoot,
                    {
                        recursive:
                            true,

                        force:
                            true
                    }
                );

            } catch {

                // Not a serious problem.

            }


            return {

                success:
                    true,

                path:
                    saveResult.filePath,

                gui:
                    looksLikeGUI

            };


        } catch (error) {

            console.error(
                "Python EXE build failed:",
                error
            );


            return {

                success:
                    false,

                canceled:
                    false,

                error:
                    error.message

            };

        }

    }
);

ipcMain.handle(
    "build-csharp-exe",

    async (
        event,
        data
    ) => {

        const {
            filename,
            content
        } = data;


        let buildRoot = null;


        try {

            /*
                Don't try to turn Unity
                scripts into standalone EXEs.
            */

            const lowerCode =
                content.toLowerCase();


            if (
                lowerCode.includes(
                    "using unityengine"
                ) ||
                lowerCode.includes(
                    ": monobehaviour"
                )
            ) {

                return {

                    success: false,

                    canceled: false,

                    error:
                        "This looks like a Unity C# script. Unity scripts need to run inside a Unity project, so they cannot be built as a standalone EXE this way."

                };

            }


            /*
                TEMP PROJECT
            */

            buildRoot =
                fs.mkdtempSync(
                    path.join(
                        os.tmpdir(),
                        "PalableAI-CSharp-"
                    )
                );


            let sourceFilename =
                filename ||
                "PalableAI_App.cs";


            if (
                !sourceFilename
                    .toLowerCase()
                    .endsWith(".cs")
            ) {

                sourceFilename += ".cs";

            }


            sourceFilename =
                sourceFilename.replace(
                    /[<>:"/\\|?*]/g,
                    "_"
                );


            const appName =
                path.basename(
                    sourceFilename,
                    ".cs"
                );


            /*
                Detect WinForms GUI.
            */

            const looksLikeWinForms =
                lowerCode.includes(
                    "system.windows.forms"
                ) ||
                lowerCode.includes(
                    "application.run("
                );


            /*
                WRITE C# SOURCE
            */

            const sourcePath =
                path.join(
                    buildRoot,
                    "Program.cs"
                );


            fs.writeFileSync(
                sourcePath,
                content,
                "utf8"
            );


            /*
                CREATE PROJECT FILE
            */

            const projectFile =
                path.join(
                    buildRoot,
                    appName + ".csproj"
                );


            let projectContents;


            if (looksLikeWinForms) {

                projectContents = `
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>

    <OutputType>WinExe</OutputType>

    <TargetFramework>net10.0-windows</TargetFramework>

    <UseWindowsForms>true</UseWindowsForms>

    <ImplicitUsings>enable</ImplicitUsings>

    <Nullable>enable</Nullable>

    <RuntimeIdentifier>win-x64</RuntimeIdentifier>

    <SelfContained>true</SelfContained>

    <PublishSingleFile>true</PublishSingleFile>

    <PublishTrimmed>false</PublishTrimmed>

  </PropertyGroup>

</Project>
`;

            } else {

                projectContents = `
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>

    <OutputType>Exe</OutputType>

    <TargetFramework>net10.0</TargetFramework>

    <ImplicitUsings>enable</ImplicitUsings>

    <Nullable>enable</Nullable>

    <RuntimeIdentifier>win-x64</RuntimeIdentifier>

    <SelfContained>true</SelfContained>

    <PublishSingleFile>true</PublishSingleFile>

    <PublishTrimmed>false</PublishTrimmed>

  </PropertyGroup>

</Project>
`;

            }


            fs.writeFileSync(
                projectFile,
                projectContents,
                "utf8"
            );


            /*
                BUILD OUTPUT
            */

            const publishFolder =
                path.join(
                    buildRoot,
                    "publish"
                );


            const arguments = [

                "publish",

                projectFile,

                "-c",
                "Release",

                "-r",
                "win-x64",

                "--self-contained",
                "true",

                "-p:PublishSingleFile=true",

                "-p:PublishTrimmed=false",

                "-o",
                publishFolder

            ];


            /*
                RUN .NET COMPILER
            */

            await new Promise(
                (
                    resolve,
                    reject
                ) => {

                    const process =
                        spawn(
                            "dotnet",
                            arguments,
                            {

                                cwd:
                                    buildRoot,

                                windowsHide:
                                    true

                            }
                        );


                    let output =
                        "";

                    let errors =
                        "";


                    process.stdout.on(
                        "data",
                        data => {

                            output +=
                                data.toString();

                        }
                    );


                    process.stderr.on(
                        "data",
                        data => {

                            errors +=
                                data.toString();

                        }
                    );


                    process.on(
                        "error",
                        error => {

                            reject(
                                error
                            );

                        }
                    );


                    process.on(
                        "close",
                        code => {

                            if (
                                code === 0
                            ) {

                                resolve();

                            } else {

                                reject(
                                    new Error(
                                        errors ||
                                        output ||
                                        ".NET build failed."
                                    )
                                );

                            }

                        }
                    );

                }
            );


            /*
                FIND EXE
            */

            const builtExe =
                path.join(
                    publishFolder,
                    appName + ".exe"
                );


            if (
                !fs.existsSync(
                    builtExe
                )
            ) {

                throw new Error(
                    "The C# build finished, but PalableAI couldn't find the generated EXE."
                );

            }


            /*
                SAVE AS
            */

            const saveResult =
                await dialog.showSaveDialog(
                    {

                        title:
                            "Save Built C# Application",

                        defaultPath:
                            appName +
                            ".exe",

                        filters: [

                            {

                                name:
                                    "Windows Application",

                                extensions: [
                                    "exe"
                                ]

                            }

                        ]

                    }
                );


            if (
                saveResult.canceled ||
                !saveResult.filePath
            ) {

                return {

                    success: false,

                    canceled: true

                };

            }


            fs.copyFileSync(
                builtExe,
                saveResult.filePath
            );


            /*
                CLEANUP
            */

            try {

                fs.rmSync(
                    buildRoot,
                    {

                        recursive: true,

                        force: true

                    }
                );

            } catch {

            }


            return {

                success: true,

                path:
                    saveResult.filePath,

                gui:
                    looksLikeWinForms

            };


        } catch (error) {

            console.error(
                "C# EXE build failed:",
                error
            );


            return {

                success: false,

                canceled: false,

                error:
                    error.message

            };

        }

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