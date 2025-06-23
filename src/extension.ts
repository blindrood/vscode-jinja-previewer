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
    // const contextIncludeKey = globalConfig.get<string | null>('contextIncludeKey'); // Old way

    // Determine effective contextIncludeKey: .jinjer-settings.json > VS Code settings > default
    let effectiveContextIncludeKey: string | null | undefined;
    if (workspaceSettings.hasOwnProperty('contextIncludeKey')) {
        effectiveContextIncludeKey = workspaceSettings.contextIncludeKey;
        console.log(`Jinjer: 🔑 Using contextIncludeKey from .jinjer-settings.json: "${effectiveContextIncludeKey}"`);
    } else {
        effectiveContextIncludeKey = globalConfig.get<string | null>('contextIncludeKey');
        console.log(`Jinjer: 🔑 Using contextIncludeKey from VS Code settings (or default): "${effectiveContextIncludeKey}"`);
    }

    // Determine contextFile: workspace setting > global setting > default
    const contextFileName = workspaceSettings.contextFile || globalConfig.get<string>('contextFile') || ".jinjer.json";

    console.log(`Jinjer: 📂 Looking for context file: ${contextFileName} (Workspace settings override: ${!!workspaceSettings.contextFile})`);

    const contextFileUri = await findContextFile(document.uri, contextFileName);

    if (!contextFileUri) {
        console.warn(`Jinjer: Context file "${contextFileName}" not found. No context will be loaded.`);
        return {};  // Return empty object if no initial context file
    }

    let contextData = {};
    try {
        // Initialize processedPaths for the top-level call
        const processedPaths = new Set<string>();
        contextData = await loadContextRecursive(contextFileUri, effectiveContextIncludeKey, processedPaths, workspaceFolder?.uri);
        console.log("Jinjer: ✅ Successfully loaded and merged context data:", contextData);
    } catch (error) {
        vscode.window.showErrorMessage(`Error loading context data: ${error}`);
        console.error("Jinjer: ❌ Error loading context data:", error);
        return {}; // Return empty on error
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

// Helper function to parse context files (JSON or YAML)
async function parseContextFile(fileUri: vscode.Uri): Promise<any> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const fileString = Buffer.from(fileContent).toString('utf8');
        const fileExtension = path.extname(fileUri.fsPath).toLowerCase();

        if (fileExtension === '.json') {
            // For JSON, parsing an empty string is an error.
            // Return {} for empty or invalid JSON to be consistent.
            try {
                // Handle case where fileString is empty or only whitespace, which is invalid JSON
                if (fileString.trim() === '') {
                    console.warn(`Jinjer: Context file ${fileUri.fsPath} is empty or contains only whitespace. Returning empty object.`);
                    return {};
                }
                return JSON.parse(fileString);
            } catch (e) {
                vscode.window.showErrorMessage(`Error parsing JSON context file ${fileUri.fsPath}: ${e}`);
                console.error(`Jinjer: ❌ Error parsing JSON context file ${fileUri.fsPath}:`, e);
                return {}; // Return empty on error
            }
        } else if (fileExtension === '.yaml' || fileExtension === '.yml') {
            const parsedYaml = yaml.load(fileString) as any;
            // yaml.load returns undefined for an empty file or a file with only comments.
            // We want to treat this as an empty object for consistent merging.
            if (parsedYaml === undefined) {
                console.warn(`Jinjer: YAML context file ${fileUri.fsPath} is empty or contains only comments. Returning empty object.`);
                return {};
            }
            return parsedYaml;
        } else {
            vscode.window.showWarningMessage(`Unsupported context file format for ${fileUri.fsPath}. Please use .json or .yaml.`);
            return {};
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error reading or parsing context file ${fileUri.fsPath}: ${error}`);
        console.error(`Jinjer: ❌ Error reading or parsing context file ${fileUri.fsPath}:`, error);
        return {}; // Return empty on error
    }
}

// Properly implements deep merging for context objects.
function deepMerge(target: any, source: any): any {
    const output = { ...target }; // Shallow copy target to start

    if (isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (key in output && isObject(output[key])) {
                    // If both target and source have an object for this key, recurse
                    output[key] = deepMerge(output[key], source[key]);
                } else {
                    // If target does not have this key or it's not an object,
                    // directly assign source's object (could be a deep clone if necessary,
                    // but for context data, direct assignment is usually fine).
                    // For simplicity and to match common expectations (like JSON.parse(JSON.stringify(obj))),
                    // we'll create a new object for source[key] if we want to ensure no shared references
                    // with the original source object, but typically this is not an issue for JSON-like data.
                    // However, the recursive call handles deeper structures.
                    output[key] = deepMerge({}, source[key]); // Ensure a new object if target didn't have one
                }
            } else {
                // Primitives, arrays, or null from source overwrite whatever is in target
                output[key] = source[key];
            }
        });
    }
    // If source is not an object (e.g. null, undefined, primitive),
    // the original prompt implied source overwrites target.
    // However, typical deepMerge implementations merge 'source' *into* 'target'.
    // If source itself isn't an object, there's nothing to iterate and merge.
    // The { ...target } handles the base case.
    // If source is null or not an object, it shouldn't typically overwrite an existing target object.
    // The definition of deepMerge implies merging object properties.
    // Let's stick to merging properties if source is an object.
    // If source is not an object, it should not alter target if target is an object.
    // If target is also not an object, then source should be returned (as per step 1 of the prompt).
    // This function assumes target is always an object due to its usage in loadContextRecursive.
    // Let's refine based on the prompt's first rule:
    // "If source is not an object or is null, return source (or target if source is undefined...)"
    // This part is tricky if the function is meant to modify target in place or return a new object.
    // The current structure returns a new object `output`.

    // Let's re-evaluate the prompt's rules for the function signature `deepMerge(target: any, source: any): any`
    // Rule 1: "If source is not an object or is null, return source..."
    // This implies if source is primitive, it replaces target.
    // This is not typical for a function named deepMerge that usually merges properties *into* a target object.
    // Let's assume the primary goal is merging object properties deeply.
    // The provided example: `deepMerge({ a: 1, b: { c: 2 } }, { b: { d: 3 }, e: 4 })`
    // results in `{ a: 1, b: { c: 2, d: 3 }, e: 4 }`. This implies target is preserved and modified.

    // Correcting based on standard deep merge behavior where target is modified or a new merged object is returned.
    // The provided solution should modify `target` (or a copy) with `source`'s properties.

    // Let's simplify and follow a common pattern:
    // Create a new object from target.
    // Iterate source. If source[key] is object and target[key] is object, recurse.
    // Else, source[key] overwrites target[key].
    // Arrays are overwritten, not merged.

    // Revised logic for clarity and standard behavior:
    if (!isObject(source)) {
        // If source is not an object, standard deep merge doesn't apply in terms of merging properties.
        // Depending on strict interpretation, if source is primitive, it could replace target if target is also primitive.
        // However, in the context of merging JSON-like objects, this case is less common for the root call.
        // For recursive calls, if source[key] is primitive, it will be handled by the else clause below.
        // If the function is called with a non-object source at the top level, returning source is reasonable.
        return source; // As per prompt's rule 1, if source is not an object.
    }

    // Ensure output is an object if target wasn't, but source is.
    const result = isObject(target) ? { ...target } : {};

    for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            const sourceValue = source[key];
            const targetValue = result[key];
            if (isObject(sourceValue) && isObject(targetValue)) {
                // Both are objects, recurse
                result[key] = deepMerge(targetValue, sourceValue);
            } else {
                // Not both objects (one might be, or neither), source overwrites
                // This also handles array replacement as arrays are !isObject(true) for our helper,
                // or if isObject includes arrays, this assignment is fine.
                // Let's refine isObject to be specific for plain objects if array merging is different.
                // Assuming isObject is for plain objects:
                result[key] = sourceValue;
            }
        }
    }
    return result;
}

// Helper to check if a value is a plain object (and not an array or null)
function isObject(item: any): boolean {
    return (item && typeof item === 'object' && !Array.isArray(item) && item !== null);
}

async function loadContextRecursive(
    contextFileUri: vscode.Uri,
    contextIncludeKey: string | null | undefined,
    processedPaths: Set<string>,
    workspaceRoot?: vscode.Uri // Optional, for resolving absolute paths if ever needed
): Promise<any> {
    const contextPathKey = contextFileUri.fsPath;

    // Check for circular dependencies
    if (processedPaths.has(contextPathKey)) {
        console.warn(`Jinjer: ⚠️ Circular dependency detected for context file: ${contextPathKey}. Skipping further processing for this path.`);
        // Return empty or some indicator, or the data from this file without processing includes,
        // to prevent infinite loop. For now, just parse and return this file's content.
        return await parseContextFile(contextFileUri);
    }

    // Add current path to the set of processed paths for this recursion branch
    processedPaths.add(contextPathKey);

    let currentContext = await parseContextFile(contextFileUri);

    if (!contextIncludeKey || typeof currentContext !== 'object' || currentContext === null) {
        // No key to look for, or currentContext is not an object, so no includes possible
        processedPaths.delete(contextPathKey); // Remove before returning
        return currentContext;
    }

    const includePaths = currentContext[contextIncludeKey];

    if (Array.isArray(includePaths)) {
        // Remove the include key from the current context to avoid it being in the final merged data
        // unless it's explicitly part of another included file.
        // Alternatively, ensure deepMerge handles this or it's filtered out at the end.
        // For now, let's leave it and assume deepMerge overwrites it if necessary.
        // delete currentContext[contextIncludeKey]; // Optional: consider if the key itself should be removed

        for (const includePathString of includePaths) {
            if (typeof includePathString !== 'string') {
                console.warn(`Jinjer: ⚠️ Invalid include path found in ${contextPathKey}: ${includePathString}. Must be a string. Skipping.`);
                continue;
            }

            let resolvedIncludeUri: vscode.Uri;
            if (path.isAbsolute(includePathString)) {
                // True absolute path, use it directly.
                resolvedIncludeUri = vscode.Uri.file(includePathString);
                console.log(`Jinjer: ➡️ Absolute include path "${includePathString}" resolved to "${resolvedIncludeUri.fsPath}"`);
            } else {
                // Relative paths are relative to the directory of the current context file.
                // contextPathKey is contextFileUri.fsPath.
                const currentContextDir = vscode.Uri.file(path.dirname(contextPathKey));
                resolvedIncludeUri = vscode.Uri.joinPath(currentContextDir, includePathString);
                console.log(`Jinjer: ↪️ Relative include path "${includePathString}" in "${contextPathKey}" resolved to "${resolvedIncludeUri.fsPath}"`);
            }

            // <<< INSERT BOUNDARY CHECK HERE >>>
            if (workspaceRoot) {
                const normalizedWorkspacePath = path.normalize(workspaceRoot.fsPath);
                const normalizedIncludePath = path.normalize(resolvedIncludeUri.fsPath);

                // Ensure paths are compared in a way that handles trailing separators consistently,
                // and considers the workspace path as a directory.
                // A simple way is to ensure the workspace path ends with a separator for startsWith.
                const workspacePathWithSep = normalizedWorkspacePath.endsWith(path.sep)
                    ? normalizedWorkspacePath
                    : normalizedWorkspacePath + path.sep;

                // On Windows, paths can be case-insensitive. For robust check, convert both to lower case.
                const isPathInsideWorkspace = process.platform === "win32"
                    ? normalizedIncludePath.toLowerCase().startsWith(workspacePathWithSep.toLowerCase())
                    : normalizedIncludePath.startsWith(workspacePathWithSep);

                if (!isPathInsideWorkspace) {
                    // Check if the include path is exactly the workspace path (e.g. including the root itself, though unlikely)
                    // This case is fine as it's not "outside".
                    const isPathExactlyWorkspace = normalizedIncludePath === normalizedWorkspacePath;
                    if (!isPathExactlyWorkspace) {
                         console.warn(`Jinjer: ⚠️ Included context file "${resolvedIncludeUri.fsPath}" is outside the current workspace ("${workspaceRoot.fsPath}"). Skipping.`);
                         continue; // Skip this include
                    }
                }
            }

            try {
                // Check if the resolved file exists before attempting to load
                // Note: parseContextFile will handle file not found, but good to log here too.
                await vscode.workspace.fs.stat(resolvedIncludeUri); // This will throw if file doesn't exist

                const includedContext = await loadContextRecursive(
                    resolvedIncludeUri,
                    contextIncludeKey,
                    processedPaths, // Pass the same set to track dependencies across the entire load operation
                    workspaceRoot
                );
                currentContext = deepMerge(currentContext, includedContext);
            } catch (error) {
                 if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                    console.warn(`Jinjer: ⚠️ Included context file not found: ${resolvedIncludeUri.fsPath}. Skipping.`);
                } else {
                    console.error(`Jinjer: ❌ Error processing included context file ${resolvedIncludeUri.fsPath}:`, error);
                    // Decide if you want to bubble the error or just skip this include
                }
            }
        }
    } else if (includePaths !== undefined) {
        // The key exists but is not an array
        console.warn(`Jinjer: ⚠️ The value of '${contextIncludeKey}' in ${contextPathKey} must be an array of strings. Found:`, includePaths);
    }

    // Remove current path from the set before returning up the recursion stack
    processedPaths.delete(contextPathKey);
    return currentContext;
}
