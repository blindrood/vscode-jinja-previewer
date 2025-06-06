import * as vscode from 'vscode';
import * as nunjucks from 'nunjucks';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { promises as fs } from 'fs';

let panel: vscode.WebviewPanel | undefined;
let activeDocument: vscode.TextDocument | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('✅ Jinjer Extension Activated!');

    const disposable = vscode.commands.registerCommand('jinjer.preview', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor.');
            return;
        }
        activeDocument = editor.document;

        if (panel) {
            panel.reveal(vscode.ViewColumn.Two);
        } else {
            panel = vscode.window.createWebviewPanel(
                'jinjaPreview',
                'Jinja Preview',
                vscode.ViewColumn.Two,
                { enableScripts: true }
            );
            panel.onDidDispose(() => {
                panel = undefined;
            });
        }

        await updateWebview();

        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document === activeDocument) {
                console.log("Jinjer: 📢 Detected document change! Updating preview...");
                updateWebview();
            }
        });

        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                activeDocument = editor.document;
                updateWebview();
            }
        });

        vscode.workspace.onDidSaveTextDocument(async (document) => {
            const config = vscode.workspace.getConfiguration('jinjer');
            const contextPath = config.get<string>('contextFile');
            if (contextPath && document.fileName.endsWith(contextPath)) {
                console.log(`📢 Context file ${document.fileName} saved! Reloading context...`);
                await updateWebview();
            }
        });
    });

    context.subscriptions.push(disposable);

    async function updateWebview() {
        if (!panel || !activeDocument) {
            return;
        }
        try {
            console.log("Jinjer: 🔄 Updating preview...");
            const contextData = await getContextData(activeDocument); // Fetches data for the template
            console.log("Jinjer: 📢 Loaded context data:", contextData);
            const templateContent = activeDocument.getText();

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeDocument.uri);
            const workspaceSettings = await getWorkspaceSettings(workspaceFolder?.uri);
            const globalConfig = vscode.workspace.getConfiguration('jinjer');

            // Determine customSearchPath: workspace > global
            let customSearchPathSetting: string | string[] | undefined = workspaceSettings.customSearchPath;
            if (customSearchPathSetting === undefined) {
                customSearchPathSetting = globalConfig.get<string | string[]>('customSearchPath');
            }

            const templateDir = path.dirname(activeDocument.fileName);
            let searchPaths: string[] = [templateDir]; // Always include the current file's directory

            if (customSearchPathSetting && workspaceFolder) {
                const workspaceRootPath = workspaceFolder.uri.fsPath;
                if (Array.isArray(customSearchPathSetting)) {
                    const resolvedCustomPaths = customSearchPathSetting.map(p => path.resolve(workspaceRootPath, p));
                    searchPaths = searchPaths.concat(resolvedCustomPaths);
                    console.log(`Jinjer: 🛣️ Using custom search paths (resolved from workspace): ${resolvedCustomPaths.join(', ')}`);
                } else if (typeof customSearchPathSetting === 'string') {
                    const resolvedCustomPath = path.resolve(workspaceRootPath, customSearchPathSetting);
                    searchPaths.push(resolvedCustomPath);
                    console.log(`Jinjer: 🛣️ Using custom search path (resolved from workspace): ${resolvedCustomPath}`);
                }
            } else if (customSearchPathSetting) {
                // If not in a workspace, relative paths might be an issue or interpreted differently.
                // For now, we'll just use them as is if they are strings/arrays of strings.
                if (Array.isArray(customSearchPathSetting)) {
                    searchPaths = searchPaths.concat(customSearchPathSetting);
                     console.log(`Jinjer: 🛣️ Using custom search paths (global, no workspace): ${customSearchPathSetting.join(', ')}`);
                } else if (typeof customSearchPathSetting === 'string') {
                    searchPaths.push(customSearchPathSetting);
                    console.log(`Jinjer: 🛣️ Using custom search path (global, no workspace): ${customSearchPathSetting}`);
                }
            }

            // Remove duplicates
            searchPaths = [...new Set(searchPaths)];
            console.log("Jinjer: 🛠️ Nunjucks configured with search paths:", searchPaths);

            const env = nunjucks.configure(searchPaths, {
                autoescape: true,
                trimBlocks: false,
                lstripBlocks: false
            });
            const renderedHtml = env.renderString(templateContent, contextData);

            if (panel) {
                panel.webview.html = getWebviewHtml(renderedHtml, activeDocument);
                console.log("Jinjer: ✅ Updated preview successfully!");
            }
        } catch (error) {
            if (panel) {
                panel.webview.html = getWebviewHtml(`<pre style="color: red;">${error}</pre>`, activeDocument);
            }
            console.error("Jinjer: ❌ Nunjucks Render Error:", error);
        }
    }
}

function getWebviewHtml(content: string, document: vscode.TextDocument): string {
    const extension = getExtension(document.fileName);
    const languageId = mapExtensionToPrism(extension);

    // Content Security Policy
    const csp = `
        default-src 'none';
        script-src 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com;
        style-src 'unsafe-inline' https://cdnjs.cloudflare.com;
        img-src 'self';
        font-src 'self';
        connect-src 'self';
    `;

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="${csp}">
          <title>Jinja Preview</title>
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.28.0/themes/prism-tomorrow.min.css">
          <!-- Load Prism core -->
          <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.28.0/prism.min.js"></script>
          <!-- Load Prism autoloader plugin -->
          <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.28.0/plugins/autoloader/prism-autoloader.min.js"></script>
          <script>
            // Configure the autoloader plugin
            Prism.plugins.autoloader.languages_path = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.28.0/components/';
            window.addEventListener('load', function() {
              Prism.highlightAll();
            });
          </script>
        </head>
        <body>
          <pre><code class="language-${languageId}">${escapeHtml(content)}</code></pre>
        </body>
        </html>
    `;
}

function getExtension(filename: string): string {
    return filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
}

function mapExtensionToPrism(extension: string): string {
    const prismMap: { [key: string]: string } = {
        "js": "javascript",
        "ts": "typescript",
        "json": "json",
        "yml": "yaml",
        "yaml": "yaml",
        "html": "html",
        "css": "css",
        "scss": "scss",
        "md": "markdown",
        "py": "python",
        "java": "java",
        "c": "c",
        "cpp": "cpp",
        "cs": "csharp",
        "go": "go",
        "php": "php",
        "rb": "ruby",
        "rs": "rust",
        "sh": "bash",
        "xml": "xml",
        "sql": "sql"
    };
    return prismMap[extension] || "plaintext";
}

function escapeHtml(content: string): string {
    return content
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

async function getWorkspaceSettings(workspaceUri: vscode.Uri | undefined): Promise<any> {
    if (!workspaceUri) {
        console.log("Jinjer: ℹ️ No workspace folder open, skipping workspace settings.");
        return {};
    }

    const globalConfig = vscode.workspace.getConfiguration('jinjer');
    const settingsFileName = globalConfig.get<string>('settingsFile');

    if (!settingsFileName) {
        console.log("Jinjer: ℹ️ `jinjer.settingsFile` is not set, skipping workspace settings.");
        return {};
    }

    const settingsFileUri = vscode.Uri.joinPath(workspaceUri, settingsFileName);
    console.log(`Jinjer: ⚙️ Looking for workspace settings file: ${settingsFileUri.fsPath}`);

    try {
        const settingsFileContent = await vscode.workspace.fs.readFile(settingsFileUri);
        const settingsString = Buffer.from(settingsFileContent).toString('utf8');
        const workspaceSettings = JSON.parse(settingsString);
        console.log("Jinjer: ✅ Successfully loaded workspace settings:", workspaceSettings);
        return workspaceSettings;
    } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
            console.log(`Jinjer: ℹ️ Workspace settings file "${settingsFileName}" not found in workspace root.`);
        } else {
            vscode.window.showErrorMessage(`Error reading workspace settings file: ${error}`);
            console.error("Jinjer: ❌ Error loading workspace settings file:", error);
        }
        return {};
    }
}

async function getContextData(document: vscode.TextDocument): Promise<any> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const workspaceSettings = await getWorkspaceSettings(workspaceFolder?.uri);

    const globalConfig = vscode.workspace.getConfiguration('jinjer');

    // Determine contextFile: workspace setting > global setting > default
    const contextFileName = workspaceSettings.contextFile || globalConfig.get<string>('contextFile') || ".jinjer.json";

    console.log(`Jinjer: 📂 Looking for context file: ${contextFileName} (Workspace settings override: ${!!workspaceSettings.contextFile})`);

    const contextFileUri = await findContextFile(document.uri, contextFileName);

    if (!contextFileUri) {
        console.error(`Jinjer: ❌ Context file "${contextFileName}" not found.`);
        return {};  // Return empty object to avoid crashes
    }

    let contextData = {};
    try {
        const contextFile = await vscode.workspace.fs.readFile(contextFileUri);
        const contextString = Buffer.from(contextFile).toString('utf8');

        if (contextFileName.endsWith('.json')) {
            contextData = JSON.parse(contextString);
        } else if (contextFileName.endsWith('.yaml') || contextFileName.endsWith('.yml')) {
            contextData = yaml.load(contextString) as any;
        } else {
            vscode.window.showWarningMessage('Unsupported context file format. Please use .json or .yaml');
        }

        console.log("Jinjer: ✅ Successfully loaded context data:", contextData);

    } catch (error) {
        vscode.window.showErrorMessage(`Error reading context file: ${error}`);
        console.error("Jinjer: ❌ Error loading context file:", error);
    }

    // Check and apply variable suffix
    // Determine variableSuffix: workspace setting > global setting > default (empty string for no suffix)
    // Note: The default for variableSuffix in package.json is "", but get() might need a default if it's not explicitly set.
    // We will ensure that if workspaceSettings.variableSuffix is explicitly an empty string, it is respected.
    let variableSuffix: string | undefined;
    if (workspaceSettings.hasOwnProperty('variableSuffix')) {
        variableSuffix = workspaceSettings.variableSuffix;
        console.log(`Jinjer: 🔍 Using variableSuffix from workspace settings: "${variableSuffix}"`);
    } else {
        variableSuffix = globalConfig.get<string>('variableSuffix');
        console.log(`Jinjer: 🔍 Using variableSuffix from global settings: "${variableSuffix}"`);
    }


    if (variableSuffix) {
        contextData = { [variableSuffix]: contextData };
        console.log("Jinjer: ✅ Applied variable suffix:", contextData);
    } else {
        console.log("Jinjer: ℹ️ Variable suffix is empty or not set, using direct context data.");
    }

    // The TODO for customSearchPath was here, but it's handled in updateWebview now
    // as it's a Nunjucks environment setting, not strictly context data.

    return contextData;
}

async function findContextFile(startUri: vscode.Uri, contextFileName: string): Promise<vscode.Uri | undefined> {
    let currentUri = vscode.Uri.file(path.dirname(startUri.fsPath));
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(startUri);

    if (!workspaceFolder) {
        console.error("Jinjer: ❌ No workspace folder found!");
        return undefined;
    }

    while (true) {
        const contextUri = vscode.Uri.joinPath(currentUri, contextFileName);
        try {
            await fs.access(contextUri.fsPath);
            return contextUri;
        } catch {}

        if (currentUri.fsPath === workspaceFolder.uri.fsPath) {break;};

        const parentPath = path.dirname(currentUri.fsPath);
        if (parentPath === currentUri.fsPath) {break;};

        currentUri = vscode.Uri.file(parentPath);
    }

    console.warn(`Jinjer: ❌ Context file "${contextFileName}" not found.`);
    return undefined;
}

export function deactivate() {}
