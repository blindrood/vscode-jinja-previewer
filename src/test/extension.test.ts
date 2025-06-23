import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import * as nunjucks from 'nunjucks';
import { activate as extensionActivate, deactivate as extensionDeactivate } from '../extension'; // Assuming activate is exportable

// Helper to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Store stubs and spies for cleanup
let stubs: sinon.SinonStub[] = [];
let spies: sinon.SinonSpy[] = [];

// Mock Memento for workspaceState and globalState
class MockMemento implements vscode.Memento {
    private _storage: Map<string, any> = new Map();

    get<T>(key: string, defaultValue?: T): T | undefined {
        return this._storage.has(key) ? this._storage.get(key) : defaultValue;
    }
    update(key: string, value: any): Thenable<void> {
        this._storage.set(key, value);
        return Promise.resolve();
    }
    keys(): readonly string[] {
        return Array.from(this._storage.keys());
    }
    // Specific to GlobalMemento, but included here for simplicity if MockMemento is used for globalState
    setKeysForSync(keys: string[]): void {
        // console.log('MockMemento: setKeysForSync called with', keys);
    }
}

// Mock SecretStorage
class MockSecretStorage implements vscode.SecretStorage {
    private secrets: Map<string, string> = new Map();
    private _onDidChange = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
    readonly onDidChange: vscode.Event<vscode.SecretStorageChangeEvent> = this._onDidChange.event;

    get(key: string): Thenable<string | undefined> {
        return Promise.resolve(this.secrets.get(key));
    }
    store(key: string, value: string): Thenable<void> {
        const oldValue = this.secrets.get(key);
        this.secrets.set(key, value);
        if (oldValue !== value) {
            this._onDidChange.fire({ key });
        }
        return Promise.resolve();
    }
    delete(key: string): Thenable<void> {
        if (this.secrets.has(key)) {
            this.secrets.delete(key);
            this._onDidChange.fire({ key });
        }
        return Promise.resolve();
    }
}

// Mock EnvironmentVariableCollection
class MockEnvironmentVariableCollection implements vscode.GlobalEnvironmentVariableCollection { // Implement Global... for ExtensionContext
    public persistent = false;
    public description: string | vscode.MarkdownString | undefined = undefined; // Added
    private _vars: Map<string, { value: string, type: vscode.EnvironmentVariableMutatorType, options: vscode.EnvironmentVariableMutatorOptions }> = new Map();

    private defaultOptions: vscode.EnvironmentVariableMutatorOptions = {
        applyAtProcessCreation: true, // Or false, provide a sensible default
        // scope is optional
    };

    replace(variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {
        this._vars.set(variable, { value, type: vscode.EnvironmentVariableMutatorType.Replace, options: { ...this.defaultOptions, ...options } });
    }
    append(variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {
        const existing = this._vars.get(variable);
        this._vars.set(variable, { value: (existing?.value || '') + value, type: vscode.EnvironmentVariableMutatorType.Append, options: { ...this.defaultOptions, ...existing?.options, ...options } });
    }
    prepend(variable: string, value: string, options?: vscode.EnvironmentVariableMutatorOptions): void {
        const existing = this._vars.get(variable);
        this._vars.set(variable, { value: value + (existing?.value || ''), type: vscode.EnvironmentVariableMutatorType.Prepend, options: { ...this.defaultOptions, ...existing?.options, ...options } });
    }

    get(variable: string): vscode.EnvironmentVariableMutator | undefined {
        const entry = this._vars.get(variable);
        if (entry) {
            return { value: entry.value, type: entry.type, options: entry.options }; // Added options
        }
        return undefined;
    }

    forEach(callback: (variable: string, mutator: vscode.EnvironmentVariableMutator, collection: vscode.EnvironmentVariableCollection) => any, thisArg?: any): void {
        this._vars.forEach((mutator, variable) => {
            callback.call(thisArg, variable, mutator, this); // mutator now includes options
        });
    }
    delete(variable: string): void { this._vars.delete(variable); }
    clear(): void { this._vars.clear(); }
    getScoped(scope: vscode.EnvironmentVariableScope): vscode.EnvironmentVariableCollection { // Added for GlobalEnvironmentVariableCollection
        // For a simple mock, you might return `this` or a new instance with some scope awareness if needed for tests
        // console.log('MockEnvironmentVariableCollection.getScoped called with scope:', scope);
        return this; // Or a more sophisticated scoped mock
    }
    [Symbol.iterator](): Iterator<[variable: string, mutator: vscode.EnvironmentVariableMutator]> {
        const entries = Array.from(this._vars.entries());
        let index = 0;
        return {
            next: () => {
                if (index < entries.length) {
                    const [variable, mutator] = entries[index++];
                    return { value: [variable, mutator] as [string, vscode.EnvironmentVariableMutator], done: false };
                }
                return { value: undefined as any, done: true };
            }
        };
    }
}

// Mock WebviewPanel
const mockWebviewPanel = {
    webview: {
        html: '',
        options: {}, // Added
        onDidReceiveMessage: sinon.stub(), // Added
        postMessage: sinon.stub().resolves(true), // Added
        asWebviewUri: (uri: vscode.Uri) => uri, // Simple passthrough
        cspSource: '', // Add cspSource property
    },
    reveal: sinon.stub(),
    onDidDispose: sinon.stub(),
    dispose: sinon.stub(),
    onDidChangeViewState: sinon.stub(), // Add onDidChangeViewState property
    options: {}, // Add options property
    title: '', // Add title property
    viewColumn: vscode.ViewColumn.One, // Add viewColumn property
    viewType: 'jinjaPreview', // Add viewType property
    visible: true, // Add visible property
    active: true // Add active property
};

// Mock LanguageModelAccessInformation
class MockLanguageModelAccessInformation implements vscode.LanguageModelAccessInformation {
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange: vscode.Event<void> = this._onDidChange.event; // Added

    get(modelId: string): Thenable<vscode.LanguageModelChat | undefined> { // Changed LanguageModelChatSession2 to LanguageModelChat
        // console.log(`MockLanguageModelAccessInformation.get called for modelId: ${modelId}`);
        return Promise.resolve(undefined); // Or mock a LanguageModelChat if needed
    }
    // Changed signature to match vscode.LanguageModelAccessInformation
    canSendRequest(chat: vscode.LanguageModelChat): boolean | undefined {
        // console.log(`MockLanguageModelAccessInformation.canSendRequest called for chat:`, chat);
        return false; // Or true, depending on test needs
    }
    // request(modelId: string, messages: LanguageModelChatMessage[], options: LanguageModelChatRequestOptions, token: CancellationToken): Thenable<LanguageModelChatResponse>;
    // sendChatRequest(modelId: string, messages: LanguageModelChatMessage[], options: LanguageModelChatRequestOptions, token: CancellationToken): LanguageModelAsyncChatResponse;
}

// --- Main Test Suite ---
suite('Jinjer Extension - Per-Workspace Configuration Tests', () => {
    const mockFileContents: Map<string, string> = new Map(); // Initialized
    let mockGlobalConfig: { [key: string]: any } = {};   // Changed to let, initialized

    let mockWorkspaceConfig: any; // This is reset in each outer setup, so `let` is fine.
    let mockWorkspaceSettingsContent: string | undefined;
    let mockWorkspaceFolder: vscode.WorkspaceFolder | undefined;

    // Spy on nunjucks.configure
    let nunjucksConfigureSpy: sinon.SinonSpy;
    let renderStringSpy: sinon.SinonSpy; // Declare renderStringSpy in the outer suite

    setup(() => {
        // Default mock states
        mockFileContents.clear();
        // Reset mockGlobalConfig by clearing its properties
        Object.keys(mockGlobalConfig).forEach(key => delete mockGlobalConfig[key]);
        // mockGlobalConfig can be seeded with common defaults here if necessary after clearing
        // e.g., mockGlobalConfig.settingsFile = '.jinjer-settings.json';

        mockWorkspaceConfig = {}; // For workspace-level VS Code settings (distinct from .jinjer-settings.json)
        mockWorkspaceSettingsContent = undefined;
        mockWorkspaceFolder = { // This is the default for the outer suite; inner suites might override locally
            uri: vscode.Uri.file(path.resolve('/fake/workspace')),
            name: 'FakeWorkspace',
            index: 0
        };

        // --- Mock VS Code API ---
        stubs.push(sinon.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any));
        stubs.push(sinon.stub(vscode.window, 'showErrorMessage')); // Stub to prevent error popups

        stubs.push(sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section) => {
            if (section === 'jinjer') {
                return {
                    get: (key: string) => mockGlobalConfig[key] ?? mockWorkspaceConfig[key], // Simplistic merge, refine if needed
                    has: (key: string) => (key in mockGlobalConfig) || (key in mockWorkspaceConfig),
                    inspect: (key: string) => ({ // Provide a basic inspect implementation
                        key: `jinjer.${key}`,
                        globalValue: mockGlobalConfig[key],
                        workspaceValue: mockWorkspaceConfig[key],
                    }),
                    update: sinon.stub().resolves()
                };
            }
            return { get: sinon.stub(), has: sinon.stub(), inspect: sinon.stub(), update: sinon.stub().resolves() } as any;
        }));

        stubs.push(sinon.stub(vscode.workspace, 'getWorkspaceFolder').callsFake(() => mockWorkspaceFolder));

        stubs.push(sinon.stub(vscode.workspace.fs, 'readFile').callsFake(async (uri: vscode.Uri) => {
            const filePath = uri.fsPath;
            if (mockFileContents.has(filePath)) {
                return Buffer.from(mockFileContents.get(filePath)!);
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }));

        stubs.push(sinon.stub(vscode.workspace.fs, 'stat').callsFake(async (uri: vscode.Uri) => {
            // Make stat succeed if readFile would succeed for simplicity, or if it's a directory
            const filePath = uri.fsPath;
            if (mockFileContents.has(filePath) || filePath === mockWorkspaceFolder?.uri.fsPath) {
                 // Determine if it's a file or directory based on typical usage or if it's the workspace folder
                const isDirectory = filePath === mockWorkspaceFolder?.uri.fsPath;
                return {
                    type: isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
                    size: mockFileContents.get(filePath)?.length || 0,
                    mtime: Date.now(),
                    ctime: Date.now()
                } as vscode.FileStat;
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }));

        // Spy on nunjucks.configure - ensure it's reset for each test
        nunjucksConfigureSpy = sinon.spy(nunjucks, 'configure');
        spies.push(nunjucksConfigureSpy);

        // Spy on nunjucks.Environment.prototype.renderString - ensure it's reset for each test
        renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        // Reset the panel's HTML content before each test
        mockWebviewPanel.webview.html = '';
        mockWebviewPanel.reveal.resetHistory();
        mockWebviewPanel.onDidDispose.resetHistory();
        (vscode.window.showErrorMessage as sinon.SinonStub).resetHistory();


        // Activate the extension for each test
        const mockContext: vscode.ExtensionContext = {
            subscriptions: [],
            workspaceState: new MockMemento(),
            globalState: new MockMemento(),
            extensionPath: '/fake/extension/path',
            storagePath: '/fake/storage/path',
            logPath: '/fake/log/path',
            extensionUri: vscode.Uri.file('/fake/extension/path'),
            environmentVariableCollection: new MockEnvironmentVariableCollection(),
            extensionMode: vscode.ExtensionMode.Test,
            globalStorageUri: vscode.Uri.file('/fake/globalStorage/uri/path'), // Uri for globalStorage
            logUri: vscode.Uri.file('/fake/log/uri/path'),
            storageUri: vscode.Uri.file('/fake/storage/uri/path'), // Uri for workspace storage if extensionKind is Workspace
            asAbsolutePath: (relativePath: string) => path.resolve('/fake/extension/path', relativePath),
            secrets: new MockSecretStorage(),
            globalStoragePath: '/fake/globalStorage/path/string', // string path for globalStorage
            extension: { // Mock vscode.Extension<any>
                id: 'mock.extension',
                extensionUri: vscode.Uri.file('/fake/extension/path'),
                extensionPath: '/fake/extension/path',
                isActive: true,
                packageJSON: {
                    name: 'jinjer',
                    version: '0.0.0',
                    publisher: 'MockPublisher',
                    // other necessary fields from package.json
                },
                exports: {},
                activate: () => Promise.resolve({}), // or mock the actual exports if needed
                extensionKind: vscode.ExtensionKind.Workspace, // Added: Or vscode.ExtensionKind.UI
                // Assuming T is 'any' for this mock
            } as vscode.Extension<any>,
            languageModelAccessInformation: new MockLanguageModelAccessInformation(),
        };
        extensionActivate(mockContext); // Activate the extension
    });

    teardown(async () => {
        stubs.forEach(stub => stub.restore());
        stubs = [];
        spies.forEach(spy => spy.restore());
        spies = [];
        if (extensionDeactivate) {
            extensionDeactivate();
        }
        // Reset any other global state if necessary
        mockWebviewPanel.onDidDispose(); // Simulate panel disposal for cleanup in extension
    });

    async function setupAndPreview(templateContent: string, templateFileName: string = 'test.jinja') {
        const docUri = vscode.Uri.joinPath(mockWorkspaceFolder!.uri, templateFileName);
        mockFileContents.set(docUri.fsPath, templateContent);

        // Mock activeTextEditor
        const mockEditor = {
            document: {
                uri: docUri,
                fileName: docUri.fsPath,
                getText: () => templateContent,
                languageId: 'jinja',
                isUntitled: false,
                isDirty: false,
                isClosed: false,
                save: sinon.stub().resolves(true),
                lineCount: templateContent.split('\n').length,
                lineAt: sinon.stub(),
                offsetAt: sinon.stub(),
                positionAt: sinon.stub(),
                validateRange: sinon.stub(),
                validatePosition: sinon.stub(),
                getWordRangeAtPosition: sinon.stub(),
                version: 1
            },
            selection: new vscode.Selection(new vscode.Position(0,0), new vscode.Position(0,0)),
            viewColumn: vscode.ViewColumn.One,
            visibleRanges: [],
            options: {},
            edit: sinon.stub(),
            insertSnippet: sinon.stub(),
            setDecorations: sinon.stub(),
            revealRange: sinon.stub(),
            show: sinon.stub()
        };

        // Remove previous stub if any, then add new one
        const existingStubIndex = stubs.findIndex(s => s.name === 'activeTextEditorStub');
        if (existingStubIndex > -1) {
            stubs[existingStubIndex].restore();
            stubs.splice(existingStubIndex, 1);
        }
        const activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor').named('activeTextEditorStub').value(mockEditor);
        stubs.push(activeTextEditorStub);


        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100); // Allow async operations in extension to complete
    }

    // --- Test Cases Will Go Here ---
    test('Initial setup - Nunjucks should be configured with global settings', async () => {
        // Global settings
        mockGlobalConfig = {
            contextFile: '.jinjer-global.json',
            variableSuffix: 'globalData',
            settingsFile: '.jinjer-settings.json' // Default, but specify for clarity
        };
        mockFileContents.set(path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer-global.json'), JSON.stringify({ name: "Global Default"}));

        await setupAndPreview('Hello {{ globalData.name }}');

        assert.ok(nunjucksConfigureSpy.called, 'Nunjucks.configure should have been called');
        assert.ok(mockWebviewPanel.webview.html.includes('Hello Global Default'), `HTML was: ${mockWebviewPanel.webview.html}`);
    });

    suite('1. Workspace Settings Override (.jinjer-settings.json)', () => {
        const workspaceSettingsFilePath = path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer-settings.json');
        const globalContextFilePath = path.join(mockWorkspaceFolder!.uri.fsPath, 'global.context.json');
        const workspaceContextFilePath = path.join(mockWorkspaceFolder!.uri.fsPath, 'workspace.context.json');
        const includeTemplatePath = path.join(mockWorkspaceFolder!.uri.fsPath, 'includes', 'included.jinja');
        const workspaceSearchPath = 'includes'; // Relative to workspace root

        setup(() => {
            // Global settings that should be overridden
            Object.keys(mockGlobalConfig).forEach(key => delete mockGlobalConfig[key]);
            mockGlobalConfig.contextFile = 'global.context.json';
            mockGlobalConfig.variableSuffix = 'g';
            mockGlobalConfig.customSearchPath = 'global_includes'; // This should be ignored
            mockGlobalConfig.settingsFile = '.jinjer-settings.json'; // Important for the test to pick up the file

            mockFileContents.set(globalContextFilePath, JSON.stringify({ G_data: "From Global Context" }));

            // Workspace .jinjer-settings.json
            const wsSettings = {
                contextFile: 'workspace.context.json',
                variableSuffix: 'ws',
                customSearchPath: workspaceSearchPath
            };
            mockFileContents.set(workspaceSettingsFilePath, JSON.stringify(wsSettings));

            // Workspace context file defined in .jinjer-settings.json
            mockFileContents.set(workspaceContextFilePath, JSON.stringify({ WS_data: "From Workspace Context" }));

            // Included template file
            mockFileContents.set(includeTemplatePath, "Included Content (Workspace Path)");
        });

        test('Should use contextFile from workspace settings', async () => {
            await setupAndPreview('Data: {{ ws.WS_data }}');
            assert.ok(
                mockWebviewPanel.webview.html.includes('Data: From Workspace Context'),
                `Expected workspace context, got: ${mockWebviewPanel.webview.html}`
            );
            // Check that the global context was not loaded by mistake
            assert.ok(
                !mockWebviewPanel.webview.html.includes('From Global Context'),
                `Should not have loaded global context data: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should apply variableSuffix from workspace settings', async () => {
            // Content of workspace.context.json is { WS_data: "From Workspace Context" }
            // With variableSuffix: 'ws', template should use {{ ws.WS_data }}
            await setupAndPreview('Suffix Test: {{ ws.WS_data }}');
            assert.ok(
                mockWebviewPanel.webview.html.includes('Suffix Test: From Workspace Context'),
                `Suffix 'ws' not applied correctly: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should use customSearchPath from workspace settings for includes', async () => {
            await setupAndPreview('Include Test: {% include "included.jinja" %}');

            const expectedSearchPath = path.resolve(mockWorkspaceFolder!.uri.fsPath, workspaceSearchPath);
            const configureArgs = nunjucksConfigureSpy.lastCall.args[0];

            assert.ok(
                Array.isArray(configureArgs) && configureArgs.includes(expectedSearchPath),
                `Nunjucks configure args did not include workspace search path. Got: ${JSON.stringify(configureArgs)}`
            );
            assert.ok(
                mockWebviewPanel.webview.html.includes('Include Test: Included Content (Workspace Path)'),
                `Include from workspace path failed: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should ignore global customSearchPath if workspace one is present', async () => {
            await setupAndPreview('{% include "somefile.jinja" %}'); // File doesn't matter here

            const configureArgs = nunjucksConfigureSpy.lastCall.args[0];
            const globalPathToAvoid = path.resolve(mockWorkspaceFolder!.uri.fsPath, 'global_includes');

            assert.ok(
                Array.isArray(configureArgs) && !configureArgs.includes(globalPathToAvoid),
                `Nunjucks configure args included global search path when it should have been overridden. Got: ${JSON.stringify(configureArgs)}`
            );
        });

        test('Should use contextIncludeKey from .jinjer-settings.json, overriding VSCode settings', async () => {
            // Set a VS Code setting for contextIncludeKey
            mockGlobalConfig.contextIncludeKey = '_vscode_key_';

            // Define .jinjer-settings.json content with a different contextIncludeKey
            const wsSettingsValues = {
                contextFile: 'ws_ctx_for_include_key_override.json',
                variableSuffix: 'ws',
                customSearchPath: 'includes',
                contextIncludeKey: '_ws_override_key_' // The override from .jinjer-settings.json
            };
            mockFileContents.set(workspaceSettingsFilePath, JSON.stringify(wsSettingsValues));

            // Define main context file and included file using the _ws_override_key_
            const mainContextContent = {
                "mainVal": "mainDataValue",
                "_ws_override_key_": ["included_by_ws_key.json"]
            };
            const includedContextContent = { "incVal": "dataFromWsOverride" };

            const mainContextPath = path.join(mockWorkspaceFolder!.uri.fsPath, wsSettingsValues.contextFile);
            mockFileContents.set(mainContextPath, JSON.stringify(mainContextContent));
            mockFileContents.set(path.join(mockWorkspaceFolder!.uri.fsPath, 'included_by_ws_key.json'), JSON.stringify(includedContextContent));

            await setupAndPreview('Template: {{ ws.mainVal }} - {{ ws.incVal }}', 'template_ws_key_override.j2');

            const contextSentToNunjucks = renderStringSpy.lastCall.args[1];
            assert.strictEqual(contextSentToNunjucks.ws.mainVal, "mainDataValue", "Test 1: Main value mismatch");
            assert.strictEqual(contextSentToNunjucks.ws.incVal, "dataFromWsOverride", "Test 1: Included value mismatch - .jinjer-settings.json key override failed");
        });

        test('Should use VSCode contextIncludeKey if not set in .jinjer-settings.json', async () => {
            mockGlobalConfig.contextIncludeKey = '_vscode_key_for_fallback_';

            const wsSettingsValues = {
                contextFile: 'ws_ctx_for_vscode_key_fallback.json',
                variableSuffix: 'ws',
                customSearchPath: 'includes'
                // No contextIncludeKey here
            };
            mockFileContents.set(workspaceSettingsFilePath, JSON.stringify(wsSettingsValues));

            const mainContextContent = {
                "mainVal": "mainDataValue2",
                "_vscode_key_for_fallback_": ["included_by_vscode_key.json"]
            };
            const includedContextContent = { "incVal": "dataFromVSCodeKeyFallback" };

            const mainContextPath = path.join(mockWorkspaceFolder!.uri.fsPath, wsSettingsValues.contextFile);
            mockFileContents.set(mainContextPath, JSON.stringify(mainContextContent));
            mockFileContents.set(path.join(mockWorkspaceFolder!.uri.fsPath, 'included_by_vscode_key.json'), JSON.stringify(includedContextContent));

            await setupAndPreview('Template: {{ ws.mainVal }} - {{ ws.incVal }}', 'template_vscode_key_fallback.j2');

            const contextSentToNunjucks = renderStringSpy.lastCall.args[1];
            assert.strictEqual(contextSentToNunjucks.ws.mainVal, "mainDataValue2", "Test 2: Main value mismatch");
            assert.strictEqual(contextSentToNunjucks.ws.incVal, "dataFromVSCodeKeyFallback", "Test 2: Included value mismatch - VSCode key fallback failed");
        });

        test('Should use default contextIncludeKey if not in .jinjer-settings.json or VSCode settings', async () => {
            delete mockGlobalConfig.contextIncludeKey;

            const wsSettingsValues = {
                contextFile: 'ws_ctx_for_default_key_fallback.json',
                variableSuffix: 'ws',
                customSearchPath: 'includes'
                // No contextIncludeKey here
            };
            mockFileContents.set(workspaceSettingsFilePath, JSON.stringify(wsSettingsValues));

            const packageDefaultKey = "_jinjer_include_contexts";
            const mainContextContent = {
                "mainVal": "mainDataValue3",
                [packageDefaultKey]: ["included_by_default_key.json"]
            };
            const includedContextContent = { "incVal": "dataFromDefaultKey" };

            const mainContextPath = path.join(mockWorkspaceFolder!.uri.fsPath, wsSettingsValues.contextFile);
            mockFileContents.set(mainContextPath, JSON.stringify(mainContextContent));
            mockFileContents.set(path.join(mockWorkspaceFolder!.uri.fsPath, 'included_by_default_key.json'), JSON.stringify(includedContextContent));

            await setupAndPreview('Template: {{ ws.mainVal }} - {{ ws.incVal }}', 'template_default_key_fallback.j2');

            const contextSentToNunjucks = renderStringSpy.lastCall.args[1];
            assert.strictEqual(contextSentToNunjucks.ws.mainVal, "mainDataValue3", "Test 3: Main value mismatch");
            assert.strictEqual(contextSentToNunjucks.ws.incVal, "dataFromDefaultKey", "Test 3: Included value mismatch - package.json default key fallback failed");
        });
    });

    suite('4. No Settings File and No Global Config (Defaults)', () => {
        const defaultContextFilePath = path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer.json'); // Default name
        const localIncludeFilePath = path.join(mockWorkspaceFolder!.uri.fsPath, 'local_include.jinja');

        setup(() => {
            // Ensure no workspace settings file
            mockFileContents.delete(path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer-settings.json'));

            // Ensure no relevant global settings
            Object.keys(mockGlobalConfig).forEach(key => delete mockGlobalConfig[key]);
            // settingsFile might be globally defined, but its target .jinjer-settings.json won't exist
            mockGlobalConfig.settingsFile = '.jinjer-settings.json';
            // Explicitly set others to undefined or ensure they are not in mockGlobalConfig
            mockGlobalConfig.contextFile = undefined;
            mockGlobalConfig.variableSuffix = undefined;
            mockGlobalConfig.customSearchPath = undefined;

            // Provide the default .jinjer.json context file
            mockFileContents.set(defaultContextFilePath, JSON.stringify({ default_data: "From Default .jinjer.json" }));
            // Provide a file for local include
            mockFileContents.set(localIncludeFilePath, "Locally Included Content");
        });

        test('Should use default context file name ".jinjer.json"', async () => {
            await setupAndPreview('Data: {{ default_data }}'); // No suffix expected by default
            assert.ok(
                mockWebviewPanel.webview.html.includes('Data: From Default .jinjer.json'),
                `Expected data from default .jinjer.json, got: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should apply no variableSuffix by default (or extension default)', async () => {
            // The extension's current default for variableSuffix is "", meaning no suffix.
            // If package.json defined a non-empty default, this test would change.
            await setupAndPreview('No Suffix Test: {{ default_data }}');
            assert.ok(
                mockWebviewPanel.webview.html.includes('No Suffix Test: From Default .jinjer.json'),
                `No suffix should be applied by default: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should allow includes relative to the template file itself', async () => {
            // The template is in mockWorkspaceFolder!.uri.fsPath ('/fake/workspace/test.jinja')
            // The include is also in mockWorkspaceFolder!.uri.fsPath ('/fake/workspace/local_include.jinja')
            // So, a relative include like "{% include './local_include.jinja' %}" or "{% include 'local_include.jinja' %}" should work.

            await setupAndPreview('Include Test: {% include "local_include.jinja" %}');

            const configureArgs = nunjucksConfigureSpy.lastCall.args[0];
            const expectedTemplateDir = path.dirname(path.join(mockWorkspaceFolder!.uri.fsPath, 'test.jinja'));

            assert.ok(
                Array.isArray(configureArgs) && configureArgs.length > 0 && configureArgs.includes(expectedTemplateDir),
                `Nunjucks configure args should include current template's directory. Got: ${JSON.stringify(configureArgs)}`
            );
            // It should not contain any other unexpected search paths from previous tests or undefined values
            const filteredConfigureArgs = configureArgs.filter((p: string | undefined) => p !== undefined && p !== null);
            assert.strictEqual(filteredConfigureArgs.length, 1, `Expected only template directory in search paths. Got: ${JSON.stringify(configureArgs)}`);

            assert.ok(
                mockWebviewPanel.webview.html.includes('Include Test: Locally Included Content'),
                `Local include failed: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should handle missing context file gracefully (render with empty context)', async () => {
            mockFileContents.delete(defaultContextFilePath); // No context file at all
            await setupAndPreview('Hello {{ name }}');
            // Expect 'Hello ' because name is undefined and Nunjucks renders undefined as empty string.
            // Also, the extension should show an error message via showErrorMessage
            assert.ok(
                mockWebviewPanel.webview.html.includes('Hello <!-- name -->') || mockWebviewPanel.webview.html.includes('Hello <span class="jinja-error">name is undefined</span>') || mockWebviewPanel.webview.html.includes('Hello '), // Nunjucks default rendering for undefined
                `Expected graceful render with missing context. Got: ${mockWebviewPanel.webview.html}`
            );
             assert.ok((vscode.window.showErrorMessage as sinon.SinonStub).calledWith(sinon.match(/Context file ".*?" not found/)),
                "showErrorMessage should have been called for missing context file");
        });
    });

    suite('3. customSearchPath Variations (via .jinjer-settings.json)', () => {
        const workspaceSettingsFilePath = path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer-settings.json');
        const includeDir1 = 'custom_includes_1';
        const includeDir2 = 'custom_includes_2';
        const includeFile1Path = path.join(mockWorkspaceFolder!.uri.fsPath, includeDir1, 'file1.jinja');
        const includeFile2Path = path.join(mockWorkspaceFolder!.uri.fsPath, includeDir2, 'file2.jinja');
        const relativeIncludeFileOuterPath = path.join(mockWorkspaceFolder!.uri.fsPath, '..', 'shared_templates', 'outer_shared.jinja');
        // For testing relative paths, we need to define what mockWorkspaceFolder's parent is, or mock resolution carefully.
        // Let's assume mockWorkspaceFolder is /fake/workspace. Then ../shared_templates is /fake/shared_templates.
        const resolvedRelativeOuterPath = path.resolve(mockWorkspaceFolder!.uri.fsPath, '..', 'shared_templates', 'outer_shared.jinja');


        setup(() => {
            // Base settings for these tests - other settings like contextFile are not the focus here.
            Object.keys(mockGlobalConfig).forEach(key => delete mockGlobalConfig[key]);
            mockGlobalConfig.settingsFile = '.jinjer-settings.json';
            mockFileContents.set(path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer.json'), JSON.stringify({ msg: "default" })); // Default context
        });

        test('3.1 Should handle customSearchPath as a single string', async () => {
            const wsSettings = { customSearchPath: includeDir1 };
            mockFileContents.set(workspaceSettingsFilePath, JSON.stringify(wsSettings));
            mockFileContents.set(includeFile1Path, "Content from single custom path");

            await setupAndPreview('{% include "file1.jinja" %}');

            const expectedSearchPath = path.resolve(mockWorkspaceFolder!.uri.fsPath, includeDir1);
            const configureArgs = nunjucksConfigureSpy.lastCall.args[0];
            assert.ok(Array.isArray(configureArgs) && configureArgs.includes(expectedSearchPath), `Nunjucks not configured with single custom path. Got: ${JSON.stringify(configureArgs)}`);
            assert.ok(mockWebviewPanel.webview.html.includes("Content from single custom path"), `HTML: ${mockWebviewPanel.webview.html}`);
        });

        test('3.2 Should handle customSearchPath as an array of strings', async () => {
            const wsSettings = { customSearchPath: [includeDir1, includeDir2] };
            mockFileContents.set(workspaceSettingsFilePath, JSON.stringify(wsSettings));
            mockFileContents.set(includeFile1Path, "Content from dir1");
            mockFileContents.set(includeFile2Path, "Content from dir2");

            await setupAndPreview('{% include "file1.jinja" %} {% include "file2.jinja" %}');

            const expectedSearchPath1 = path.resolve(mockWorkspaceFolder!.uri.fsPath, includeDir1);
            const expectedSearchPath2 = path.resolve(mockWorkspaceFolder!.uri.fsPath, includeDir2);
            const configureArgs = nunjucksConfigureSpy.lastCall.args[0];

            assert.ok(Array.isArray(configureArgs) && configureArgs.includes(expectedSearchPath1), `Nunjucks not configured with first custom path. Got: ${JSON.stringify(configureArgs)}`);
            assert.ok(Array.isArray(configureArgs) && configureArgs.includes(expectedSearchPath2), `Nunjucks not configured with second custom path. Got: ${JSON.stringify(configureArgs)}`);
            assert.ok(mockWebviewPanel.webview.html.includes("Content from dir1"), `HTML missing content from dir1: ${mockWebviewPanel.webview.html}`);
            assert.ok(mockWebviewPanel.webview.html.includes("Content from dir2"), `HTML missing content from dir2: ${mockWebviewPanel.webview.html}`);
        });

        test('3.3 Should correctly resolve relative paths like `../` in customSearchPath', async () => {
            const relativePath = '../shared_templates';
            const wsSettings = { customSearchPath: [relativePath] };
            mockFileContents.set(workspaceSettingsFilePath, JSON.stringify(wsSettings));
            // Simulate the file existing at the resolved relative path
            mockFileContents.set(resolvedRelativeOuterPath, "Content from ../shared_templates/outer_shared.jinja");

            await setupAndPreview('{% include "outer_shared.jinja" %}');

            const expectedSearchPath = resolvedRelativeOuterPath.substring(0, resolvedRelativeOuterPath.lastIndexOf(path.sep)); // Get the directory part
            const configureArgs = nunjucksConfigureSpy.lastCall.args[0];

            assert.ok(
                Array.isArray(configureArgs) && configureArgs.includes(expectedSearchPath),
                `Nunjucks configure args did not include resolved relative path. Expected dir: ${expectedSearchPath}. Got: ${JSON.stringify(configureArgs)}`
            );
            assert.ok(
                mockWebviewPanel.webview.html.includes("Content from ../shared_templates/outer_shared.jinja"),
                `Include from relative path failed: ${mockWebviewPanel.webview.html}`
            );
        });
    });

    suite('2. Fallback to Global Settings (No .jinjer-settings.json)', () => {
        const globalContextFilePath = path.join(mockWorkspaceFolder!.uri.fsPath, 'global-fallback.context.json');
        const globalIncludeTemplatePath = path.join(mockWorkspaceFolder!.uri.fsPath, 'global_includes_fallback', 'included_fallback.jinja');
        const globalSearchPath = 'global_includes_fallback'; // Relative to workspace root

        setup(() => {
            // Ensure no workspace settings file is defined for these tests
            mockFileContents.delete(path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer-settings.json'));
            // Or ensure mockWorkspaceSettingsContent is undefined if that's the primary mechanism used by getWorkspaceSettings mock
            // For this test, explicitly not setting mockFileContents for '.jinjer-settings.json' is key.

            // Global settings that should be used
            Object.keys(mockGlobalConfig).forEach(key => delete mockGlobalConfig[key]);
            mockGlobalConfig.contextFile = 'global-fallback.context.json';
            mockGlobalConfig.variableSuffix = 'gFallback';
            mockGlobalConfig.customSearchPath = globalSearchPath;
            mockGlobalConfig.settingsFile = '.jinjer-settings.json'; // Extension will look for this, but it won't be found

            mockFileContents.set(globalContextFilePath, JSON.stringify({ GF_data: "From Global Fallback Context" }));
            mockFileContents.set(globalIncludeTemplatePath, "Included Content (Global Fallback Path)");
        });

        test('Should use contextFile from global settings', async () => {
            await setupAndPreview('Data: {{ gFallback.GF_data }}');
            assert.ok(
                mockWebviewPanel.webview.html.includes('Data: From Global Fallback Context'),
                `Expected global fallback context, got: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should apply variableSuffix from global settings', async () => {
            await setupAndPreview('Suffix Test: {{ gFallback.GF_data }}');
            assert.ok(
                mockWebviewPanel.webview.html.includes('Suffix Test: From Global Fallback Context'),
                `Suffix 'gFallback' not applied correctly from global: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should use customSearchPath from global settings for includes', async () => {
            await setupAndPreview('Include Test: {% include "included_fallback.jinja" %}');

            const expectedSearchPath = path.resolve(mockWorkspaceFolder!.uri.fsPath, globalSearchPath);
            const configureArgs = nunjucksConfigureSpy.lastCall.args[0];

            assert.ok(
                Array.isArray(configureArgs) && configureArgs.includes(expectedSearchPath),
                `Nunjucks configure args did not include global search path. Got: ${JSON.stringify(configureArgs)}`
            );
            assert.ok(
                mockWebviewPanel.webview.html.includes('Include Test: Included Content (Global Fallback Path)'),
                `Include from global fallback path failed: ${mockWebviewPanel.webview.html}`
            );
        });
    });

});

// --- Suite for Context Inclusion Tests (NEW, ISOLATED SETUP) ---
suite('Context Inclusion Tests (New)', () => {
    let testSuiteStubs: sinon.SinonStub[] = [];
    let testSuiteSpies: sinon.SinonSpy[] = [];
    const mockFileContents = new Map<string, string>();
    const mockJinjerConfig: { [key: string]: any } = {};
    let mockWorkspaceFolder: vscode.WorkspaceFolder;
    const testFixtureRoot = path.resolve(__dirname, 'testFixture', 'contextIncludes');
    const getFixtureUri = (fileName: string) => vscode.Uri.file(path.join(testFixtureRoot, fileName));
    let activeTextEditorStub: sinon.SinonStub | undefined = undefined;

    // Spies that will be initialized in beforeEach and used by tests
    let renderStringSpy: sinon.SinonSpy;
    let consoleWarnSpy: sinon.SinonSpy;
    let nunjucksConfigureSpy: sinon.SinonSpy;

    beforeEach(async () => {
        mockFileContents.clear();
        Object.keys(mockJinjerConfig).forEach(key => delete mockJinjerConfig[key]);
        // Set default configurations for this suite
        mockJinjerConfig.contextIncludeKey = '_jinjer_include_contexts';
        mockJinjerConfig.contextFile = 'context.json'; // Default for most tests
        mockJinjerConfig.variableSuffix = '';

        mockWorkspaceFolder = {
            uri: vscode.Uri.file(testFixtureRoot),
            name: 'ContextIncludesTestWorkspace',
            index: 0
        };

        // Stub vscode.workspace.getConfiguration
        const getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section) => {
            if (section === 'jinjer') {
                return {
                    get: (key: string) => mockJinjerConfig[key],
                    has: (key: string) => key in mockJinjerConfig,
                    inspect: (key: string) => ({ key: `jinjer.${key}`, globalValue: mockJinjerConfig[key], defaultValue: undefined, workspaceValue: undefined, globalLanguageValue: undefined, workspaceFolderValue: undefined, workspaceFolderLanguageValue: undefined, languageIds: undefined}),
                    update: sinon.stub().callsFake(async (key:string, value:any) => { mockJinjerConfig[key] = value; return Promise.resolve(); }) // Basic stub for update
                };
            }
            // IMPORTANT: For non-'jinjer' sections, call the original function if possible,
            // or return a generic stub. This prevents breaking other parts of VS Code a test might touch.
            // However, in a focused unit test, you might only care about your section.
            // For this self-contained suite, we might need to ensure other configurations are not touched
            // or are handled by a broader mechanism if tests interact with them.
            // Returning a generic stub for non-jinjer sections:
            return {
                get: sinon.stub().returns(undefined),
                has: sinon.stub().returns(false),
                inspect: sinon.stub().returns(undefined),
                update: sinon.stub().resolves()
            } as any;
        });
        testSuiteStubs.push(getConfigurationStub);

        // Stub vscode.workspace.fs.readFile
        const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').callsFake(async (uri: vscode.Uri) => {
            const filePath = uri.fsPath;
            if (mockFileContents.has(filePath)) {
                return Buffer.from(mockFileContents.get(filePath)!);
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        });
        testSuiteStubs.push(readFileStub);

        // Stub vscode.workspace.fs.stat
        const statStub = sinon.stub(vscode.workspace.fs, 'stat').callsFake(async (uri: vscode.Uri) => {
            const filePath = uri.fsPath;
            // Check if it's the specific workspace folder URI for directory type
            if (filePath === mockWorkspaceFolder.uri.fsPath) {
                return {
                    type: vscode.FileType.Directory,
                    size: 0,
                    mtime: Date.now(),
                    ctime: Date.now()
                } as vscode.FileStat;
            }
            // Check if it's a file in our mock file system
            if (mockFileContents.has(filePath)) {
                return {
                    type: vscode.FileType.File,
                    size: mockFileContents.get(filePath)?.length || 0,
                    mtime: Date.now(),
                    ctime: Date.now()
                } as vscode.FileStat;
            }
            // For any other path, including subdirectories that are not explicitly defined,
            // throw FileNotFound unless we add more sophisticated directory mocking.
            // For context inclusion, we mostly care about specific files existing.
            // If a directory needs to exist for path.dirname to work, stat might be called on it.
            // For simplicity, let's assume only files or the root workspace folder are stat-ed.
            // If a test needs a directory to exist, it should be mocked in mockFileContents with a special value,
            // or this stub needs to be smarter. For now, this is typical for file-based ops.
            throw vscode.FileSystemError.FileNotFound(uri);
        });
        testSuiteStubs.push(statStub);

        // Stub vscode.workspace.getWorkspaceFolder
        const getWorkspaceFolderStub = sinon.stub(vscode.workspace, 'getWorkspaceFolder').returns(mockWorkspaceFolder);
        testSuiteStubs.push(getWorkspaceFolderStub);

        // Stub vscode.window.activeTextEditor
        const dummyDocUri = vscode.Uri.joinPath(mockWorkspaceFolder.uri, 'dummy_template_new.j2');
        const mockEditor = {
            document: { uri: dummyDocUri, fileName: dummyDocUri.fsPath, getText: () => "" }
        };
        if (activeTextEditorStub && typeof activeTextEditorStub.restore === 'function') {
            activeTextEditorStub.restore(); // Restore if it was stubbed in a previous test run by this suite
        }
        activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor').returns(mockEditor as any);
        testSuiteStubs.push(activeTextEditorStub);

        // Stub vscode.window.createWebviewPanel
        // Using the global mockWebviewPanel defined at the top of the file.
        const createWebviewPanelStub = sinon.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);
        testSuiteStubs.push(createWebviewPanelStub);

        // Stub console.warn
        consoleWarnSpy = sinon.spy(console, 'warn'); // Assign to suite-level variable
        testSuiteSpies.push(consoleWarnSpy);

        // Spy on nunjucks.Environment.prototype.renderString
        renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString'); // Assign to suite-level variable
        testSuiteSpies.push(renderStringSpy);

        // Spy on nunjucks.configure
        nunjucksConfigureSpy = sinon.spy(nunjucks, 'configure'); // Assign to suite-level variable
        testSuiteSpies.push(nunjucksConfigureSpy);

        // Activate the extension
        const mockMemento = new MockMemento(); // Using the class defined at the top
        const mockContext: vscode.ExtensionContext = {
            subscriptions: [], workspaceState: mockMemento, globalState: mockMemento,
            extensionPath: '/fake/path_new_suite', storagePath: '/fake/storage_new', logPath: '/fake/log_new', extensionUri: vscode.Uri.file('/fake_new_suite'),
            environmentVariableCollection: new MockEnvironmentVariableCollection(), extensionMode: vscode.ExtensionMode.Test,
            globalStorageUri: vscode.Uri.file('/fake_new_suite/globalStorage'), logUri: vscode.Uri.file('/fake_new_suite/logUri'), storageUri: vscode.Uri.file('/fake_new_suite/storageUri'),
            asAbsolutePath: (p) => path.resolve('/fake_new_suite',p), secrets: new MockSecretStorage(),
            globalStoragePath: '/fake_new_suite/globalStoragePath',
            extension: { id: 'test.jinjer.new', extensionPath: '/fake_new_suite', isActive: false, packageJSON: {name: "jinjer-test", version: "0.0.0"}, activate: (() => ({})) as any, exports: {}, extensionKind: vscode.ExtensionKind.Workspace } as any,
            languageModelAccessInformation: new MockLanguageModelAccessInformation()
        };
        // Ensure extensionActivate is available. It's imported at the top of the file.
        if (extensionActivate) {
            await extensionActivate(mockContext);
        }
    });

    afterEach(async () => {
        testSuiteStubs.forEach(s => s.restore());
        testSuiteStubs = [];
        testSuiteSpies.forEach(s => s.restore());
        testSuiteSpies = [];

        // activeTextEditorStub is already in testSuiteStubs, so it's restored there.
        activeTextEditorStub = undefined;

        if (extensionDeactivate) {
            extensionDeactivate();
        }
        // Spies on prototypes or global objects need explicit restoration if not in testSuiteSpies
        // or if the spy wrapper itself isn't what's stored.
        // Nunjucks spies are on prototypes, console.warn is global.
        // The `sinon.spy` calls above replace the method with a spy. Restoring them:
        if ((nunjucks.Environment.prototype.renderString as sinon.SinonSpy).restore) {
            (nunjucks.Environment.prototype.renderString as sinon.SinonSpy).restore();
        }
        if ((nunjucks.configure as sinon.SinonSpy).restore) {
            (nunjucks.configure as sinon.SinonSpy).restore();
        }
        if ((console.warn as sinon.SinonSpy).restore) {
            (console.warn as sinon.SinonSpy).restore();
        }
    });

    // Placeholder test removed, actual tests will be inserted below by copying from the old suite and adapting.

    test('No Include Key', async () => {
        mockJinjerConfig.contextFile = 'main_no_include.json';
        const mainContent = { val: "main_no_include_val" };
        mockFileContents.set(getFixtureUri('main_no_include.json').fsPath, JSON.stringify(mainContent));

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];
        assert.deepStrictEqual(contextUsed, mainContent);
    });

    test('Empty Include List', async () => {
        mockJinjerConfig.contextFile = 'main_empty_include.json';
        const mainContent = { val: "main_empty_include_val", "_jinjer_include_contexts": [] };
        mockFileContents.set(getFixtureUri('main_empty_include.json').fsPath, JSON.stringify(mainContent));

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];
        assert.deepStrictEqual(contextUsed, mainContent);
    });

    test('Single Include', async () => {
        mockJinjerConfig.contextFile = 'main_single_include.json';

        const mainContent = { "mainVal": "m_single", "_jinjer_include_contexts": ["include1.json"] };
        const include1Content = { "inclVal": "i1_single" };

        mockFileContents.set(getFixtureUri('main_single_include.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('include1.json').fsPath, JSON.stringify(include1Content));

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsedByNunjucks = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "mainVal": "m_single",
            "inclVal": "i1_single",
            "_jinjer_include_contexts": ["include1.json"]
        };
        assert.deepStrictEqual(contextUsedByNunjucks, expectedContext);
    });

    test('Nested Include (Multi-Level)', async () => {
        mockJinjerConfig.contextFile = 'main_multi_level.json';

        const mainContent = { "mainVal": "m_multi", "_jinjer_include_contexts": ["level1.json"] };
        const level1Content = { "l1Val": "l1_multi", "_jinjer_include_contexts": ["level2.json"] };
        const level2Content = { "l2Val": "l2_multi" };

        mockFileContents.set(getFixtureUri('main_multi_level.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('level1.json').fsPath, JSON.stringify(level1Content));
        mockFileContents.set(getFixtureUri('level2.json').fsPath, JSON.stringify(level2Content));

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "mainVal": "m_multi",
            "l1Val": "l1_multi",
            "l2Val": "l2_multi",
            "_jinjer_include_contexts": ["level2.json"]
        };
        assert.deepStrictEqual(contextUsed, expectedContext);
    });

    test('Merge Conflict (Last Include Wins for conflicting keys)', async () => {
        mockJinjerConfig.contextFile = 'main_conflict.json';

        const mainContent = { "key": "main_val", "mainOnlyKey": "main_only_val", "_jinjer_include_contexts": ["conflict_source.json"] };
        const conflictContent = { "key": "conflict_val", "conflictOnlyKey": "conflict_only_val" };

        mockFileContents.set(getFixtureUri('main_conflict.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('conflict_source.json').fsPath, JSON.stringify(conflictContent));

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "key": "conflict_val",
            "mainOnlyKey": "main_only_val",
            "conflictOnlyKey": "conflict_only_val",
            "_jinjer_include_contexts": ["conflict_source.json"]
        };
        assert.deepStrictEqual(contextUsed, expectedContext);
    });

    test('Relative Path Navigation(../common.json)', async () => {
        mockJinjerConfig.contextFile = 'main_relative_up.json';

        const mainContent = { "mainVal": "main_relative_up_val", "_jinjer_include_contexts": ["../common_data.json"] };
        const commonDataContent = { "commonVal": "common_data_val" };

        mockFileContents.set(getFixtureUri('base/main_relative_up.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('common_data.json').fsPath, JSON.stringify(commonDataContent));

        // For this test, the "active document" needs to be in the 'base' subdirectory
        // so that 'main_relative_up.json' is found correctly by findContextFile.
        // The beforeEach already sets up activeTextEditor with 'dummy_template_new.j2' at the testFixtureRoot.
        // We need to override it for this test.
        if (activeTextEditorStub && typeof activeTextEditorStub.restore === 'function') {
            activeTextEditorStub.restore(); // remove the default one from beforeEach
        }
        const dummyInBaseDocUri = getFixtureUri('base/dummy_in_base.j2');
        activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor').returns({
            document: { uri: dummyInBaseDocUri, fileName: dummyInBaseDocUri.fsPath, getText: () => "" }
        } as any);
        testSuiteStubs.push(activeTextEditorStub); // Add for cleanup by suite's afterEach

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "mainVal": "main_relative_up_val",
            "commonVal": "common_data_val",
            "_jinjer_include_contexts": ["../common_data.json"]
        };
        assert.deepStrictEqual(contextUsed, expectedContext);
    });

    test('Relative Path Include (./subdir/file.json)', async () => {
        mockJinjerConfig.contextFile = 'main_relative_path.json';

        const mainContent = { "mainVal": "main_relative_val", "_jinjer_include_contexts": ["./subdir/relative.json"] };
        const relativeContent = { "relativeVal": "relative_subdir_val" };

        mockFileContents.set(getFixtureUri('main_relative_path.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('subdir/relative.json').fsPath, JSON.stringify(relativeContent));

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "mainVal": "main_relative_val",
            "relativeVal": "relative_subdir_val",
            "_jinjer_include_contexts": ["./subdir/relative.json"]
        };
        assert.deepStrictEqual(contextUsed, expectedContext);
    });

    test('Circular Dependency', async () => {
        mockJinjerConfig.contextFile = 'main_circular_a.json';

        const circAContent = { "val_a": "a", "shared_key": "from_a", "_jinjer_include_contexts": ["main_circular_b.json"] };
        const circBContent = { "val_b": "b", "shared_key": "from_b", "_jinjer_include_contexts": ["main_circular_a.json"] };

        mockFileContents.set(getFixtureUri('main_circular_a.json').fsPath, JSON.stringify(circAContent));
        mockFileContents.set(getFixtureUri('main_circular_b.json').fsPath, JSON.stringify(circBContent));

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "val_a": "a",
            "val_b": "b",
            "shared_key": "from_a",
            "_jinjer_include_contexts": ["main_circular_b.json"]
        };
        assert.deepStrictEqual(contextUsed, expectedContext);
        assert.ok(consoleWarnSpy.calledWith(sinon.match(/Circular dependency detected/)), 'Expected console.warn for circular dependency');
    });

    test('Non-existent Include', async () => {
        mockJinjerConfig.contextFile = 'main_non_existent_include.json';

        const mainContent = { "mainVal": "main_val", "_jinjer_include_contexts": ["non_existent.json"] };
        mockFileContents.set(getFixtureUri('main_non_existent_include.json').fsPath, JSON.stringify(mainContent));

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        assert.deepStrictEqual(contextUsed, mainContent);
        assert.ok(consoleWarnSpy.calledWith(sinon.match(/Included context file not found/)), 'Expected console.warn for missing include file');
        assert.ok(consoleWarnSpy.calledWith(sinon.match(/non_existent.json/)), 'Expected non_existent.json to be mentioned in the warning');
    });

    test('Include YAML from JSON', async () => {
        mockJinjerConfig.contextFile = 'main_include_yaml.json';

        const mainContent = { "mainJsonVal": "main_json_val", "_jinjer_include_contexts": ["data.yaml"] };
        const yamlContentString = `yamlVal: "yaml_val"\notherYamlKey: "other_yaml_key_val"`;
        const expectedYamlParsed = { yamlVal: "yaml_val", otherYamlKey: "other_yaml_key_val" };

        mockFileContents.set(getFixtureUri('main_include_yaml.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('data.yaml').fsPath, yamlContentString);

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "mainJsonVal": "main_json_val",
            ...expectedYamlParsed,
            "_jinjer_include_contexts": ["data.yaml"]
        };
        assert.deepStrictEqual(contextUsed, expectedContext);
    });

    test('Absolute Path Include (mocked as absolute)', async () => {
        mockJinjerConfig.contextFile = 'main_absolute_include.json';
        const includePathString = '/abs_path_to/absolute_target.json';

        const mainContent = { "mainVal": "main_abs_val", "_jinjer_include_contexts": [includePathString] };
        const absoluteTargetContent = { "absTargetVal": "abs_target_val" };

        mockFileContents.set(getFixtureUri('main_absolute_include.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(includePathString, JSON.stringify(absoluteTargetContent)); // Keyed by the "absolute" path

        const pathIsAbsoluteStub = sinon.stub(path, 'isAbsolute').callsFake((p: string) => p === includePathString);
        testSuiteStubs.push(pathIsAbsoluteStub);

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "mainVal": "main_abs_val",
            "absTargetVal": "abs_target_val",
            "_jinjer_include_contexts": [includePathString]
        };
        assert.deepStrictEqual(contextUsed, expectedContext);
        assert.ok(pathIsAbsoluteStub.calledWith(includePathString), 'path.isAbsolute was not called with the include string');
    });

    test('Should skip include outside workspace (relative path)', async () => {
        mockJinjerConfig.contextFile = 'main_includes_outside_relative.json';

        const mainContent = {
            "mainVal": "m1",
            "_jinjer_include_contexts": ["../outside_file.json"]
        };
        const outsideContent = { "outsideVal": "val_outside" };

        mockFileContents.set(getFixtureUri('main_includes_outside_relative.json').fsPath, JSON.stringify(mainContent));
        const outsideFilePath = path.resolve(mockWorkspaceFolder.uri.fsPath, '../outside_file.json');
        mockFileContents.set(outsideFilePath, JSON.stringify(outsideContent));

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        const contextUsed = renderStringSpy.lastCall.args[1];
        assert.deepStrictEqual(contextUsed, {
            "mainVal": "m1",
            "_jinjer_include_contexts": ["../outside_file.json"]
        }, "Context should not contain data from outside_file.json");

        assert.ok(consoleWarnSpy.calledWith(sinon.match(/is outside the current workspace/)), 'Expected console.warn for outside workspace');
        assert.ok(consoleWarnSpy.calledWith(sinon.match(path.basename(outsideFilePath))), 'Warning should mention the problematic file path');
    });

    test('Should skip include outside workspace (absolute path)', async () => {
        mockJinjerConfig.contextFile = 'main_includes_outside_absolute.json';
        const tempDir = require('os').tmpdir();
        const absoluteOutsidePath = path.normalize(path.join(tempDir, 'jinjer_test_outside_abs.json'));

        const mainContent = {
            "mainVal": "m2",
            "_jinjer_include_contexts": [absoluteOutsidePath]
        };
        const outsideContent = { "outsideAbsVal": "val_abs_outside" };

        mockFileContents.set(getFixtureUri('main_includes_outside_absolute.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(absoluteOutsidePath, JSON.stringify(outsideContent));

        const pathIsAbsoluteStub = sinon.stub(path, 'isAbsolute').callsFake((p: string) => {
            if (p === absoluteOutsidePath) {return true;}
            return require('path').posix.isAbsolute(p) || require('path').win32.isAbsolute(p);
        });
        testSuiteStubs.push(pathIsAbsoluteStub);

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        const contextUsed = renderStringSpy.lastCall.args[1];
        assert.deepStrictEqual(contextUsed, {
            "mainVal": "m2",
            "_jinjer_include_contexts": [absoluteOutsidePath]
        }, "Context should not contain data from absolute_outside_file.json");

        assert.ok(consoleWarnSpy.calledWith(sinon.match(/is outside the current workspace/)), 'Expected console.warn for outside workspace');
        assert.ok(consoleWarnSpy.calledWith(sinon.match(path.basename(absoluteOutsidePath))), 'Warning should mention the problematic file path');
    });

    test('Should load include inside workspace (absolute path)', async () => {
        mockJinjerConfig.contextFile = 'main_includes_inside_absolute.json';
        const absoluteInsidePath = path.join(mockWorkspaceFolder.uri.fsPath, 'included_abs_inside.json');

        const mainContent = {
            "mainVal": "m3",
            "_jinjer_include_contexts": [absoluteInsidePath]
        };
        const insideContent = { "insideAbsVal": "val_abs_inside" };

        mockFileContents.set(getFixtureUri('main_includes_inside_absolute.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(absoluteInsidePath, JSON.stringify(insideContent));

        const pathIsAbsoluteStub = sinon.stub(path, 'isAbsolute').callsFake((p: string) => {
            if (p === absoluteInsidePath) {return true;}
            return require('path').posix.isAbsolute(p) || require('path').win32.isAbsolute(p);
        });
        testSuiteStubs.push(pathIsAbsoluteStub);

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        const contextUsed = renderStringSpy.lastCall.args[1];
        assert.deepStrictEqual(contextUsed, {
            "mainVal": "m3",
            "insideAbsVal": "val_abs_inside",
            "_jinjer_include_contexts": [absoluteInsidePath]
        }, "Context should contain data from absolute_inside_file.json");

        const warningCall = consoleWarnSpy.getCalls().find(call => call.args.some((arg: string) => typeof arg === 'string' && arg.includes('is outside the current workspace')));
        assert.strictEqual(warningCall, undefined, 'Should not warn for valid absolute path inside workspace');
    });

    test('Should load absolute include when no workspace is open', async () => {
        // Simulate no workspace being open
        const getWorkspaceFolderStubInstance = testSuiteStubs.find(s => s.name === 'getWorkspaceFolder'); // Assuming stubs are named or identifiable
        if (getWorkspaceFolderStubInstance && (getWorkspaceFolderStubInstance as sinon.SinonStub).name === 'getWorkspaceFolder') { // Check if it's the correct stub
            (getWorkspaceFolderStubInstance as sinon.SinonStub).returns(undefined);
        } else {
            // This is a fallback or error if the specific stub isn't found as expected.
            // This indicates a potential issue in how stubs are stored or named in setup.
            // For this test, we'll proceed, but ideally the stub should be precisely controlled.
            console.warn("Test 'Should load absolute include when no workspace is open': Could not reliably modify getWorkspaceFolder stub. It might have been already restored or not named.");
            // If it's critical, re-stub it and add to testSuiteStubs for this test only.
            const tempGetWorkspaceFolderStub = sinon.stub(vscode.workspace, 'getWorkspaceFolder').returns(undefined);
            testSuiteStubs.push(tempGetWorkspaceFolderStub); // Ensure this temporary stub is cleaned up
        }

        const looseFileDir = require('os').tmpdir();
        const looseFileName = 'loosefile_for_no_ws_test.j2';
        const looseFileUri = vscode.Uri.file(path.join(looseFileDir, looseFileName));

        if (activeTextEditorStub && typeof activeTextEditorStub.restore === 'function') {
            activeTextEditorStub.restore();
        }
        activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor').returns({
            document: { uri: looseFileUri, fileName: looseFileUri.fsPath, getText: () => "{{mainVal}} {{absVal}}" }
        } as any);
        testSuiteStubs.push(activeTextEditorStub);

        mockJinjerConfig.contextFile = 'main_abs_include_no_workspace.json';
        const absoluteIncludePath = path.resolve(require('os').tmpdir(), 'abs_data_no_ws.json');

        const mainContent = { "mainVal": "m4", "_jinjer_include_contexts": [absoluteIncludePath] };
        const includeContent = { "absVal": "val_abs_no_ws" };

        // Main context file is relative to the loose file itself
        mockFileContents.set(path.join(looseFileDir, 'main_abs_include_no_workspace.json'), JSON.stringify(mainContent));
        mockFileContents.set(absoluteIncludePath, JSON.stringify(includeContent));

        const pathIsAbsoluteStub = sinon.stub(path, 'isAbsolute').callsFake((p: string) => {
            if (p === absoluteIncludePath) {return true;}
            return require('path').posix.isAbsolute(p) || require('path').win32.isAbsolute(p);
        });
        testSuiteStubs.push(pathIsAbsoluteStub);

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        const contextUsed = renderStringSpy.lastCall.args[1];
        assert.deepStrictEqual(contextUsed, {
            "mainVal": "m4",
            "absVal": "val_abs_no_ws",
            "_jinjer_include_contexts": [absoluteIncludePath]
        }, "Context should load absolute path when no workspace is open");

        const warningCall = consoleWarnSpy.getCalls().find(call => call.args.some((arg: string) => typeof arg === 'string' && arg.includes('is outside the current workspace')));
        assert.strictEqual(warningCall, undefined, 'Should not warn about workspace boundary if no workspace is open');
    });

    test('Should correctly merge context when an empty YAML file is included', async () => {
        // This test uses the files created for this specific bug:
        // - main_empty_yaml_include.json (main context, includes others)
        // - data_before_empty.json (data that should persist)
        // - empty.yaml (the problematic empty YAML file)
        // - data_after_empty.json (data that should also be loaded, and potentially overwrite)
        mockJinjerConfig.contextFile = 'main_empty_yaml_include.json'; // Set the main context file for the test

        // Define the content of the files
        const mainContent = {
            "message": "Main context",
            "_jinjer_include_contexts": [ // Using default include key for this test suite
                "./data_before_empty.json",
                "./empty.yaml",
                "./data_after_empty.json"
            ]
        };
        const dataBeforeContent = {
            "data_before": "This data should persist",
            "shared_key": "from_before"
        };
        const emptyYamlContent = "# This YAML is empty"; // Or just ""
        const dataAfterContent = {
            "data_after": "This data should also be present",
            "shared_key": "from_after" // This should overwrite the one from data_before
        };

        // Set the mock file contents
        mockFileContents.set(getFixtureUri('main_empty_yaml_include.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('data_before_empty.json').fsPath, JSON.stringify(dataBeforeContent));
        mockFileContents.set(getFixtureUri('empty.yaml').fsPath, emptyYamlContent);
        mockFileContents.set(getFixtureUri('data_after_empty.json').fsPath, JSON.stringify(dataAfterContent));

        // Trigger the preview update to load and process context
        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100); // Allow async operations to complete

        // Assert that Nunjucks' renderString was called
        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');

        // Get the context that was actually passed to Nunjucks
        const contextUsedByNunjucks = renderStringSpy.lastCall.args[1];

        // Define the expected final context
        const expectedContext = {
            "message": "Main context",
            "data_before": "This data should persist", // From data_before_empty.json
            "data_after": "This data should also be present", // From data_after_empty.json
            "shared_key": "from_after", // Overwritten by data_after_empty.json
            "_jinjer_include_contexts": [ // This key from the main file should remain
                "./data_before_empty.json",
                "./empty.yaml",
                "./data_after_empty.json"
            ]
        };

        // Perform the assertion
        assert.deepStrictEqual(contextUsedByNunjucks, expectedContext, "Context was not merged correctly with an empty YAML include.");

        // Also check that console.warn was called for the empty YAML file
        assert.ok(
            consoleWarnSpy.calledWith(sinon.match(/YAML context file .*empty.yaml is empty or contains only comments. Returning empty object./)),
            "Expected console.warn for empty YAML file."
        );
    });
});
// --- End of Suite for Context Inclusion Tests (NEW, ISOLATED SETUP) ---
