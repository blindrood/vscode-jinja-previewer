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
    let mockGlobalConfig: any;
    let mockWorkspaceConfig: any;
    let mockWorkspaceSettingsContent: string | undefined;
    let mockFileContents: Map<string, string>; // path -> content
    let mockWorkspaceFolder: vscode.WorkspaceFolder | undefined;

    // Spy on nunjucks.configure
    let nunjucksConfigureSpy: sinon.SinonSpy;

    setup(() => {
        // Default mock states
        mockGlobalConfig = {};
        mockWorkspaceConfig = {}; // For workspace-level VS Code settings (distinct from .jinjer-settings.json)
        mockWorkspaceSettingsContent = undefined;
        mockFileContents = new Map();
        mockWorkspaceFolder = {
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
            mockGlobalConfig = {
                contextFile: 'global.context.json',
                variableSuffix: 'g',
                customSearchPath: 'global_includes', // This should be ignored
                settingsFile: '.jinjer-settings.json' // Important for the test to pick up the file
            };
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
    });

    suite('4. No Settings File and No Global Config (Defaults)', () => {
        const defaultContextFilePath = path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer.json'); // Default name
        const localIncludeFilePath = path.join(mockWorkspaceFolder!.uri.fsPath, 'local_include.jinja');

        setup(() => {
            // Ensure no workspace settings file
            mockFileContents.delete(path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer-settings.json'));

            // Ensure no relevant global settings
            mockGlobalConfig = {
                // settingsFile might be globally defined, but its target .jinjer-settings.json won't exist
                settingsFile: '.jinjer-settings.json',
                // Explicitly set others to undefined or ensure they are not in mockGlobalConfig
                contextFile: undefined,
                variableSuffix: undefined,
                customSearchPath: undefined
            };

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
            mockGlobalConfig = { settingsFile: '.jinjer-settings.json' };
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
            mockGlobalConfig = {
                contextFile: 'global-fallback.context.json',
                variableSuffix: 'gFallback',
                customSearchPath: globalSearchPath,
                settingsFile: '.jinjer-settings.json' // Extension will look for this, but it won't be found
            };
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

// --- Suite for Context Inclusion Tests ---
suite('Context Inclusion Tests', () => {
    // REMOVED: let mockFileContents: Map<string, string>;
    // We will use mockFileContents from the outer suite scope.
    let mockWorkspaceFolder: vscode.WorkspaceFolder; // This is fine, it's specific to this suite's setup.
    const testFixtureRoot = path.resolve(__dirname, 'testFixture', 'contextIncludes'); // Adjusted path

    // Helper to get the URI for a test fixture file
    const getFixtureUri = (fileName: string) => vscode.Uri.file(path.join(testFixtureRoot, fileName));

    // This will hold the original getConfiguration stub if we were to capture it,
    // but since we are REMOVING the inner stub, this might not be needed here.
    // let originalGetConfiguration: sinon.SinonStub | undefined;

    setup(async () => {
        // mockFileContents is from the outer scope. It will be cleared in beforeEach.
        mockWorkspaceFolder = { // This mockWorkspaceFolder is specific to this suite's tests
            uri: vscode.Uri.file(testFixtureRoot),
            name: 'ContextIncludesTestWorkspace',
            index: 0
        };

        // Ensure the getConfiguration stub from the outer suite is available
        // This is a bit tricky due to nested suites. We might need to re-stub or ensure it's broadly scoped.
        // For simplicity, let's assume the outer suite's stubs are active or re-apply similar logic.

        // Override vscode.workspace.fs.readFile and vscode.workspace.fs.stat for our test files
        // These stubs are pushed to the global `stubs` array by the outer suite's setup.
        // We need to ensure they are aware of our new mockFileContents map.
        // The best approach is to ensure the stubs created in the outer suite's setup
        // use the `mockFileContents` and `mockWorkspaceFolder` that we can update here.
        // This requires `mockFileContents` and `mockWorkspaceFolder` to be declared at a scope accessible
        // to the `readFile` and `stat` stubs. Let's assume they are, or adjust.
        // For this example, I'll re-define the stubs for fs operations to be self-contained for this suite
        // if necessary, or rely on careful ordering and cleanup.

        // The existing stubs for fs.readFile and fs.stat should be fine if they use a shared, updatable mockFileContents.
        // Let's ensure our local mockFileContents is used by those stubs.
        // This might involve directly manipulating the map used by the outer stubs, or re-stubbing.
        // For now, let's assume we can populate the `mockFileContents` map that the existing stubs use.
        // This requires `mockFileContents` from the outer scope to be assigned here.
        // This is problematic with strict `let` scoping in `setup`.
        // A better way: the outer suite's `mockFileContents` should be cleared and re-populated here.
        // Or, `setupAndPreview` needs to be adapted, or we create a new `getTestData` that sets up its own mocks for fs.

        // REMOVED: Stubbing of vscode.workspace.getConfiguration from inner suite's setup.
        // The tests in this suite will rely on the getConfiguration stub from the outer suite,
        // and will modify the shared mockGlobalConfig in beforeEach or directly in tests.

        // The following stubs for activeTextEditor and getWorkspaceFolder are also potentially
        // redundant if the outer suite's setup is sufficient and mockWorkspaceFolder is
        // updated correctly for this suite's context.
        // For now, these are kept as they might be providing suite-specific behavior for these elements.
        // However, they also push to the global `stubs` array.

        // Populate mockFileContents with actual files from the testFixture directory
        // This is crucial. The tests will rely on `fs.readFile` stub to provide these.
        // We need a way to tell the `fs.readFile` stub about these files.
        // The simplest is to load them into the globally defined `mockFileContents` from the outer suite.
        // This is a bit of a hack due to test structure.
        // A cleaner way would be for the `fs.readFile` stub itself to actually read from disk for test fixtures.
        // For now, let's assume we'll manually populate `mockFileContents` in each test for the files it needs.
        // Or, even better, make `getTestData` set up the `mockFileContents` for the specific context files.

        // Reset active document for `getContextData` which relies on `vscode.window.activeTextEditor`
        // The `getContextData` function itself doesn't use the content of the activeTextEditor,
        // only its URI to find the workspace and search for context files.
        const dummyDocUri = vscode.Uri.joinPath(mockWorkspaceFolder.uri, 'dummy_template.j2');
        const mockEditor = {
            document: { uri: dummyDocUri, fileName: dummyDocUri.fsPath, getText: () => "" }
        };
        // Ensure existing stub is restored before creating a new one or use .returns() to change behavior
        let activeTextEditorStub = stubs.find(s => s && s.name === 'activeTextEditorStub' && (s as any).stub);
        if (activeTextEditorStub) {
            (activeTextEditorStub as sinon.SinonStub).returns(mockEditor);
        } else {
            stubs.push(sinon.stub(vscode.window, 'activeTextEditor').named('activeTextEditorStub').returns(mockEditor));
        }
        stubs.push(sinon.stub(vscode.workspace, 'getWorkspaceFolder').returns(mockWorkspaceFolder));

    });

    teardown(async () => {
        // The stubs pushed by this suite's setup (if any remain) and by individual tests
        // (e.g. path.isAbsolute stub, console.warn spy) are added to the global `stubs` and `spies`
        // arrays, which are cleaned by the outer suite's teardown. So, no specific teardown
        // for stubs is needed here if that system works as intended.

        // Clean up global config updates specifically made by this suite's tests/beforeEach
        await vscode.workspace.getConfiguration('jinjer').update('contextIncludeKey', undefined, vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('jinjer').update('contextFile', undefined, vscode.ConfigurationTarget.Global);
    });

    /**
     * Helper function to simulate file system for context loading tests.
     * It populates the mockFileContents map which is used by the fs.readFile stub.
     * It then calls the actual getContextData function (assuming it's exported).
     * @param mainDocumentName The name of the "template" file, used to determine search start.
     * @param contextFileName The name of the context file to search for.
     * @param filesToMock A map where keys are file names (relative to testFixtureRoot) and values are their content.
     */
    // `mockFileContents` and `mockGlobalConfig` are from the outer suite.
    // `setupAndPreview` is also from the outer suite.
    // `spies` array is from the outer suite for centralized cleanup.

    beforeEach(() => {
        // Clear the mockFileContents from the outer suite.
        if (mockFileContents && typeof mockFileContents.clear === 'function') {
            mockFileContents.clear();
        } else {
            // This case should ideally not happen if mockFileContents is correctly from the outer scope.
            // console.warn("Context Inclusion Tests: Outer mockFileContents not found or not a Map.");
        }

        // Reset relevant parts of the outer mockGlobalConfig, or set defaults for this suite
        if (mockGlobalConfig) {
            mockGlobalConfig['contextIncludeKey'] = '_jinjer_include_contexts';
            mockGlobalConfig['contextFile'] = 'context.json'; // Default for most tests
            mockGlobalConfig['variableSuffix'] = ''; // No suffix by default
        } else {
            // This case should ideally not happen.
            // console.warn("Context Inclusion Tests: Outer mockGlobalConfig not found.");
        }
    });

    test('No Include Key', async () => {
        mockGlobalConfig['contextFile'] = 'main_no_include.json';
        const mainContent = { val: "main_no_include_val" };
        mockFileContents.set(getFixtureUri('main_no_include.json').fsPath, JSON.stringify(mainContent));

        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        await setupAndPreview('{{ val }}', 'dummy.j2');

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];
        assert.deepStrictEqual(contextUsed, mainContent);
    });

    test('Empty Include List', async () => {
        mockGlobalConfig['contextFile'] = 'main_empty_include.json';
        const mainContent = { val: "main_empty_include_val", "_jinjer_include_contexts": [] };
        mockFileContents.set(getFixtureUri('main_empty_include.json').fsPath, JSON.stringify(mainContent));

        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        await setupAndPreview('{{ val }}', 'dummy.j2');

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];
        assert.deepStrictEqual(contextUsed, mainContent);
    });

    test('Single Include', async () => {
        mockGlobalConfig['contextFile'] = 'main_single_include.json'; // Set the main context file for the test

        const mainContent = { "mainVal": "m_single", "_jinjer_include_contexts": ["include1.json"] };
        const include1Content = { "inclVal": "i1_single" };

        // Populate the mock file system
        mockFileContents.set(getFixtureUri('main_single_include.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('include1.json').fsPath, JSON.stringify(include1Content));

        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy); // Add to global spies list for cleanup

        // Trigger the preview. The active document URI helps locate the context file.
        // The content of dummy.j2 doesn't matter, only its path for context resolution.
        await setupAndPreview('{{ mainVal }} {{ inclVal }}', 'dummy.j2');

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsedByNunjucks = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "mainVal": "m_single",
            "inclVal": "i1_single",
            "_jinjer_include_contexts": ["include1.json"] // The include key itself remains
        };
        assert.deepStrictEqual(contextUsedByNunjucks, expectedContext);
    });

    test('Nested Include (Multi-Level)', async () => {
        mockGlobalConfig['contextFile'] = 'main_multi_level.json';

        const mainContent = { "mainVal": "m_multi", "_jinjer_include_contexts": ["level1.json"] };
        const level1Content = { "l1Val": "l1_multi", "_jinjer_include_contexts": ["level2.json"] };
        const level2Content = { "l2Val": "l2_multi" };

        mockFileContents.set(getFixtureUri('main_multi_level.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('level1.json').fsPath, JSON.stringify(level1Content));
        mockFileContents.set(getFixtureUri('level2.json').fsPath, JSON.stringify(level2Content));

        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        await setupAndPreview('{{ mainVal }} {{ l1Val }} {{ l2Val }}', 'dummy.j2');

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "mainVal": "m_multi",
            "l1Val": "l1_multi",
            "l2Val": "l2_multi",
            "_jinjer_include_contexts": ["level2.json"] // from level1.json, as it's merged last at that level
        };
        // The _jinjer_include_contexts from main.json is overwritten by level1.json's during merge.
        // And level2.json has no include key, so level1's remains.
        assert.deepStrictEqual(contextUsed, expectedContext);
    });

    test('Merge Conflict (Last Include Wins for conflicting keys)', async () => {
        mockGlobalConfig['contextFile'] = 'main_conflict.json';

        const mainContent = { "key": "main_val", "mainOnlyKey": "main_only_val", "_jinjer_include_contexts": ["conflict_source.json"] };
        const conflictContent = { "key": "conflict_val", "conflictOnlyKey": "conflict_only_val" };

        mockFileContents.set(getFixtureUri('main_conflict.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('conflict_source.json').fsPath, JSON.stringify(conflictContent));

        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        await setupAndPreview('{{ key }} {{ mainOnlyKey }} {{ conflictOnlyKey }}', 'dummy.j2');

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "key": "conflict_val", // Value from conflict_source.json should overwrite main.json
            "mainOnlyKey": "main_only_val",
            "conflictOnlyKey": "conflict_only_val",
            "_jinjer_include_contexts": ["conflict_source.json"]
        };
        assert.deepStrictEqual(contextUsed, expectedContext);
    });

    test('Relative Path Navigation(../common.json)', async () => {
        // The context file to be found is 'base/main_relative_up.json'
        // So, the "active document" for context searching needs to be conceptually in the 'base' subdir
        // or the contextFile path needs to be 'base/main_relative_up.json'.
        // Let's make the active document in 'base' so findContextFile starts searching from there.
        mockGlobalConfig['contextFile'] = 'main_relative_up.json'; // This file will be searched for starting from dummy_in_base.j2's dir.

        const mainContent = { "mainVal": "main_relative_up_val", "_jinjer_include_contexts": ["../common_data.json"] };
        const commonDataContent = { "commonVal": "common_data_val" };

        // main_relative_up.json is in base/
        mockFileContents.set(getFixtureUri('base/main_relative_up.json').fsPath, JSON.stringify(mainContent));
        // common_data.json is in the parent of base/ (which is testFixtureRoot)
        mockFileContents.set(getFixtureUri('common_data.json').fsPath, JSON.stringify(commonDataContent));

        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        // The dummy template is effectively at 'testFixtureRoot/base/dummy_in_base.j2'
        // This ensures getContextData starts searching for 'main_relative_up.json' from the 'base' directory.
        await setupAndPreview('{{ mainVal }} {{ commonVal }}', 'base/dummy_in_base.j2');

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
        mockGlobalConfig['contextFile'] = 'main_relative_path.json';

        const mainContent = { "mainVal": "main_relative_val", "_jinjer_include_contexts": ["./subdir/relative.json"] };
        const relativeContent = { "relativeVal": "relative_subdir_val" };

        mockFileContents.set(getFixtureUri('main_relative_path.json').fsPath, JSON.stringify(mainContent));
        // The path for relative.json should be testFixtureRoot + '/subdir/relative.json'
        mockFileContents.set(getFixtureUri('subdir/relative.json').fsPath, JSON.stringify(relativeContent));


        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        // The main_relative_path.json is at the root of testFixtureRoot for context searching.
        // The include path ./subdir/relative.json will be resolved from testFixtureRoot.
        await setupAndPreview('{{ mainVal }} {{ relativeVal }}', 'dummy.j2');

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
        mockGlobalConfig['contextFile'] = 'main_circular_a.json';

        const circAContent = { "val_a": "a", "shared_key": "from_a", "_jinjer_include_contexts": ["main_circular_b.json"] };
        const circBContent = { "val_b": "b", "shared_key": "from_b", "_jinjer_include_contexts": ["main_circular_a.json"] };

        mockFileContents.set(getFixtureUri('main_circular_a.json').fsPath, JSON.stringify(circAContent));
        mockFileContents.set(getFixtureUri('main_circular_b.json').fsPath, JSON.stringify(circBContent));

        // Spy on console.warn for circular dependency message
        const consoleWarnSpy = sinon.spy(console, 'warn');
        spies.push(consoleWarnSpy);

        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        await setupAndPreview('{{ val_a }} {{ val_b }} {{ shared_key }}', 'dummy.j2');

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        // Expected: main_circular_a is loaded first. It tries to load main_circular_b.
        // main_circular_b is loaded. It tries to load main_circular_a.
        // main_circular_a is detected in processedPaths, so its content (as parsed initially) is returned to b.
        // Then b's content (now merged with a's original) is returned to a.
        // So, b's version of shared_key should win as it's merged into a.
        const expectedContext = {
            "val_a": "a",
            "val_b": "b",
            "shared_key": "from_a", // main_circular_a loads main_circular_b. main_circular_b's content is merged into main_circular_a.
                                  // When main_circular_b tries to load main_circular_a again, it gets main_circular_a's content *without* a second merge of B.
                                  // So, the content of A (which has its include key) is merged with B.
                                  // A is target, B is source. B's shared_key overwrites A's.
                                  // Wait, the deepMerge is (target, source).
                                  // 1. Load A: {val_a, shared_key:from_a, _inc: [B]}
                                  // 2. Process include B:
                                  //    Load B: {val_b, shared_key:from_b, _inc: [A]}
                                  //    Process include A for B: A is in processedPaths. Parse A: {val_a, shared_key:from_a, _inc: [B]}. This is `includedContext` for B.
                                  //    Merge (B, A_parsed_raw): B = {...B, ...A_parsed_raw}. So B.shared_key becomes "from_a". B._inc becomes [B] from A.
                                  //    Context from B's recursion: {val_b:"b", val_a:"a", shared_key:"from_a", _inc:[B]}
                                  // 3. Merge B_processed into A: A = {...A, ...B_processed}
                                  //    A.shared_key was "from_a", B_processed.shared_key is "from_a". So it's "from_a".
                                  //    A._inc was [B], B_processed._inc is [B]. So it's [B].
                                  // This implies shared_key should be "from_a".
                                  // Let's trace again:
                                  // loadRecursive(A, key, processed={}):
                                  //  processed.add(A_path)
                                  //  currentContextA = parse(A) = { val_a:"a", shared_key:"from_a", _inc:[B] }
                                  //  loop include "B":
                                  //   resolvedB = path_B
                                  //   includedContextB = loadRecursive(B, key, processed={A_path}):
                                  //    processed.add(B_path) -> processed={A_path, B_path}
                                  //    currentContextB = parse(B) = { val_b:"b", shared_key:"from_b", _inc:[A] }
                                  //    loop include "A":
                                  //     resolvedA = path_A
                                  //     A_path is in processedPaths. WARN circular.
                                  //     return parse(A) = { val_a:"a", shared_key:"from_a", _inc:[B] } -> this is innerIncludedContextA
                                  //    currentContextB = deepMerge(currentContextB, innerIncludedContextA)
                                  //                = deepMerge({val_b:"b",shared_key:"from_b",_inc:[A]}, {val_a:"a",shared_key:"from_a",_inc:[B]})
                                  //                = {val_b:"b", val_a:"a", shared_key:"from_a", _inc:[B]}
                                  //    processed.delete(B_path)
                                  //    return currentContextB -> this is includedContextB for A's load.
                                  //  currentContextA = deepMerge(currentContextA, includedContextB)
                                  //              = deepMerge({val_a:"a",shared_key:"from_a",_inc:[B]}, {val_b:"b",val_a:"a",shared_key:"from_a",_inc:[B]})
                                  //              = {val_a:"a", val_b:"b", shared_key:"from_a", _inc:[B]}
                                  //  processed.delete(A_path)
                                  //  return currentContextA

            "_jinjer_include_contexts": ["main_circular_a.json"] // From main_circular_b.json, as it's merged last into A (and its include of A is skipped)
                                                              // No, from the trace above, it should be _inc:[B] from A, which was itself from B's include of A, then merged.
                                                              // The final A is merged with (B merged with raw A).
                                                              // So A's original _inc:[B] is merged with B's _inc:[B] (which came from raw A). Result: _inc:[B]
        };
         assert.deepStrictEqual(contextUsed, {
            "val_a": "a",
            "val_b": "b",
            "shared_key": "from_a", // Correct from the detailed trace.
            "_jinjer_include_contexts": ["main_circular_b.json"] // Corrected based on detailed trace.
        });


        // Check that a warning for circular dependency was logged
        assert.ok(consoleWarnSpy.calledWith(sinon.match(/Circular dependency detected/)), 'Expected console.warn for circular dependency');
    });

    test('Non-existent Include', async () => {
        mockGlobalConfig['contextFile'] = 'main_non_existent_include.json';

        const mainContent = { "mainVal": "main_val", "_jinjer_include_contexts": ["non_existent.json"] };
        // non_existent.json is NOT added to mockFileContents

        mockFileContents.set(getFixtureUri('main_non_existent_include.json').fsPath, JSON.stringify(mainContent));

        const consoleWarnSpy = sinon.spy(console, 'warn');
        spies.push(consoleWarnSpy);

        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        await setupAndPreview('{{ mainVal }}', 'dummy.j2');

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        // Expected: mainContent is loaded, the include of non_existent.json is skipped.
        assert.deepStrictEqual(contextUsed, mainContent);

        // Check that a warning for the missing file was logged
        assert.ok(consoleWarnSpy.calledWith(sinon.match(/Included context file not found/)), 'Expected console.warn for missing include file');
        assert.ok(consoleWarnSpy.calledWith(sinon.match(/non_existent.json/)), 'Expected non_existent.json to be mentioned in the warning');
    });

    test('Include YAML from JSON', async () => {
        mockGlobalConfig['contextFile'] = 'main_include_yaml.json';

        const mainContent = { "mainJsonVal": "main_json_val", "_jinjer_include_contexts": ["data.yaml"] };
        const yamlContentString = `yamlVal: "yaml_val"\notherYamlKey: "other_yaml_key_val"`; // Raw YAML string
        const expectedYamlParsed = { yamlVal: "yaml_val", otherYamlKey: "other_yaml_key_val" };


        mockFileContents.set(getFixtureUri('main_include_yaml.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('data.yaml').fsPath, yamlContentString); // Store raw YAML string

        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        await setupAndPreview('{{ mainJsonVal }} {{ yamlVal }} {{ otherYamlKey }}', 'dummy.j2');

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');
        const contextUsed = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "mainJsonVal": "main_json_val",
            ...expectedYamlParsed, // Spread the parsed YAML content
            "_jinjer_include_contexts": ["data.yaml"]
        };
        assert.deepStrictEqual(contextUsed, expectedContext);
    });

    test('Absolute Path Include (mocked as absolute)', async () => {
        mockGlobalConfig['contextFile'] = 'main_absolute_include.json';
        const includePathString = '/abs_path_to/absolute_target.json'; // Path that isAbsolute will be true for

        const mainContent = { "mainVal": "main_abs_val", "_jinjer_include_contexts": [includePathString] };
        const absoluteTargetContent = { "absTargetVal": "abs_target_val" };

        // Main file is relative to testFixtureRoot
        mockFileContents.set(getFixtureUri('main_absolute_include.json').fsPath, JSON.stringify(mainContent));
        // The "absolute" file's content is keyed by the exact path string used in the include
        mockFileContents.set(includePathString, JSON.stringify(absoluteTargetContent));


        // Stub path.isAbsolute for this test case
        const pathIsAbsoluteStub = sinon.stub(path, 'isAbsolute').callsFake((p: string) => {
            if (p === includePathString) {
                return true;
            }
            // Fallback to original for other paths if any are checked (though unlikely in this specific code path)
            // For a more robust stub, you might need to call original `path.isAbsolute` for other paths.
            // However, loadContextRecursive only calls it for includePathString.
            return false; // Default for any other path it might be called with in this test's context.
        });
        stubs.push(pathIsAbsoluteStub); // Manage this stub for cleanup by the main teardown

        const renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);

        // The 'dummy_abs.j2' is just to provide a starting point for findContextFile.
        // main_absolute_include.json will be found relative to testFixtureRoot.
        await setupAndPreview('{{ mainVal }} {{ absTargetVal }}', 'dummy_abs.j2');

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

    // All context inclusion tests are now added.
});
