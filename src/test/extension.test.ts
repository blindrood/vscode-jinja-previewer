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

// Mock WebviewPanel
const mockWebviewPanel = {
    webview: {
        html: '',
        onDidDispose: sinon.stub(),
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
            workspaceState: { get: sinon.stub(), update: sinon.stub().resolves() } as any,
            globalState: { get: sinon.stub(), update: sinon.stub().resolves(), setKeysForSync: sinon.stub() } as any,
            extensionPath: '/fake/extension/path',
            storagePath: '/fake/storage/path',
            logPath: '/fake/log/path',
            extensionUri: vscode.Uri.file('/fake/extension/path'),
            environmentVariableCollection: {} as any,
            extensionMode: vscode.ExtensionMode.Test,
            globalStorageUri: vscode.Uri.file('/fake/globalStorage/path'),
            logUri: vscode.Uri.file('/fake/log/path'),
            storageUri: vscode.Uri.file('/fake/storage/path'),
            asAbsolutePath: (relativePath: string) => path.resolve('/fake/extension/path', relativePath),
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
        const activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor').value(mockEditor);
        activeTextEditorStub.displayName = 'activeTextEditorStub'; // For easier debugging
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
