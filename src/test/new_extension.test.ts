import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import * as nunjucks from 'nunjucks';
import { activate, deactivate } from '../extension';

// Helper to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

suite('Jinja Compatibility Tests', () => {
    test('Should render dict.keys() correctly with installJinjaCompat', () => {
        const env = nunjucks.configure({ autoescape: true });
        // @ts-ignore - installJinjaCompat is an experimental option not yet in Nunjucks' types
        nunjucks.installJinjaCompat();

        const template = '{% set test = {"key1": "value1"} %} {% for key in test.keys() %} {{key}} {% endfor %}';
        const result = env.renderString(template, {});

        // Trim the result to remove any potential leading/trailing whitespace
        assert.strictEqual(result.trim(), 'key1', 'Template should render key1');
    });
});

suite('Extension Test Suite', () => {
    let stubs: sinon.SinonStub[] = [];
    let mockContext: vscode.ExtensionContext;

    suiteSetup(() => {
        mockContext = {
            subscriptions: [],
            workspaceState: { get: () => {}, update: () => Promise.resolve(), keys: () => [] } as vscode.Memento,
            globalState: { get: () => {}, update: () => Promise.resolve(), keys: () => [] } as vscode.Memento,
            extensionPath: '/fake/extension/path',
            storagePath: '/fake/storage/path',
            logPath: '/fake/log/path',
            asAbsolutePath: (relativePath: string) => path.resolve('/fake/extension/path', relativePath),
        } as any;
        activate(mockContext);
    });

    suiteTeardown(() => {
        if (deactivate) {
            deactivate();
        }
    });

    teardown(() => {
        stubs.forEach(stub => stub.restore());
        stubs = [];
    });

    async function setupAndPreview(templateContent: string, templateFileName: string = 'test.jinja', context: any = null) {
        const docUri = vscode.Uri.file(path.resolve('/fake/workspace', templateFileName));

        const mockEditor = {
            document: {
                uri: docUri,
                fileName: docUri.fsPath,
                getText: () => templateContent,
                languageId: 'jinja',
            },
        };

        const activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor').value(mockEditor);
        stubs.push(activeTextEditorStub);

        const mockWebviewPanel = {
            webview: {
                html: '',
                asWebviewUri: (uri: vscode.Uri) => uri,
            },
            reveal: sinon.stub(),
            onDidDispose: sinon.stub(),
        };
        const createWebviewPanelStub = sinon.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any);
        stubs.push(createWebviewPanelStub);

        if (context) {
            const readFileSyncStub = sinon.stub(require('fs'), 'readFileSync');
            readFileSyncStub.withArgs(path.resolve('/fake/workspace/.jinjer.json')).returns(JSON.stringify(context));
            stubs.push(readFileSyncStub);
        }

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        return mockWebviewPanel;
    }

    test('Should render a simple template', async () => {
        const template = '<h1>Hello World</h1>';
        const panel = await setupAndPreview(template);
        assert.ok(panel.webview.html.includes(template), `HTML was: ${panel.webview.html}`);
    });

    test('Should load context from .jinjer.json', async () => {
        const template = '<h1>Hello {{ name }}</h1>';
        const context = { name: 'World' };

        // Mocking fs.readFileSync
        const readFileSyncStub = sinon.stub(require('fs'), 'readFileSync');
        readFileSyncStub.withArgs(path.resolve('/fake/workspace/.jinjer.json')).returns(JSON.stringify(context));
        stubs.push(readFileSyncStub);

        const panel = await setupAndPreview(template);
        assert.ok(panel.webview.html.includes('<h1>Hello World</h1>'), `HTML was: ${panel.webview.html}`);
    });

    test('Should load context from .jinjer.json', async () => {
        const template = '<h1>Hello {{ name }}</h1>';
        const context = { name: 'World' };
        const panel = await setupAndPreview(template, 'test.jinja', context);
        assert.ok(panel.webview.html.includes('<h1>Hello World</h1>'), `HTML was: ${panel.webview.html}`);
    });

    test('Should handle includes', async () => {
        const template = '{% include "other.jinja" %}';
        const otherTemplate = '<h1>Included</h1>';

        const readFileSyncStub = sinon.stub(require('fs'), 'readFileSync');
        readFileSyncStub.withArgs(path.resolve('/fake/workspace/other.jinja')).returns(otherTemplate);
        stubs.push(readFileSyncStub);

        const panel = await setupAndPreview(template);
        assert.ok(panel.webview.html.includes(otherTemplate), `HTML was: ${panel.webview.html}`);
    });

    test('Should respect custom context file setting', async () => {
        const template = '<h1>Hello {{ name }}</h1>';
        const context = { name: 'World' };

        // Mocking vscode.workspace.getConfiguration
        const getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string) => {
                if (key === 'contextFile') {
                    return 'custom.json';
                }
            },
        } as any);
        stubs.push(getConfigurationStub);

        const readFileSyncStub = sinon.stub(require('fs'), 'readFileSync');
        readFileSyncStub.withArgs(path.resolve('/fake/workspace/custom.json')).returns(JSON.stringify(context));
        stubs.push(readFileSyncStub);

        const panel = await setupAndPreview(template);
        assert.ok(panel.webview.html.includes('<h1>Hello World</h1>'), `HTML was: ${panel.webview.html}`);
    });

    test('Should respect workspace settings', async () => {
        const template = '<h1>Hello {{ name }}</h1>';
        const context = { name: 'World' };
        const workspaceSettings = {
            contextFile: 'workspace.json'
        };

        // Mocking vscode.workspace.getConfiguration to return global settings
        const getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string) => {
                if (key === 'contextFile') {
                    return 'global.json';
                }
            },
        } as any);
        stubs.push(getConfigurationStub);

        const readFileSyncStub = sinon.stub(require('fs'), 'readFileSync');
        // Workspace settings file
        readFileSyncStub.withArgs(path.resolve('/fake/workspace/.jinjer-settings.json')).returns(JSON.stringify(workspaceSettings));
        // Workspace context file
        readFileSyncStub.withArgs(path.resolve('/fake/workspace/workspace.json')).returns(JSON.stringify(context));
        stubs.push(readFileSyncStub);

        const panel = await setupAndPreview(template);
        assert.ok(panel.webview.html.includes('<h1>Hello World</h1>'), `HTML was: ${panel.webview.html}`);
    });
});

suite('Per-Workspace Configuration Tests', () => {
    let stubs: sinon.SinonStub[] = [];
    let spies: sinon.SinonSpy[] = [];
    const mockFileContents: Map<string, string> = new Map();
    let mockGlobalConfig: { [key: string]: any } = {};
    let mockWorkspaceConfig: any;
    let mockWorkspaceFolder: vscode.WorkspaceFolder | undefined;
    let nunjucksConfigureSpy: sinon.SinonSpy;
    let renderStringSpy: sinon.SinonSpy;
    let mockContext: vscode.ExtensionContext;
    let mockWebviewPanel: { webview: { html: string } };

    suiteSetup(() => {
        mockContext = {
            subscriptions: [],
            workspaceState: { get: () => {}, update: () => Promise.resolve(), keys: () => [] } as vscode.Memento,
            globalState: { get: () => {}, update: () => Promise.resolve(), keys: () => [] } as vscode.Memento,
            extensionPath: '/fake/extension/path',
            storagePath: '/fake/storage/path',
            logPath: '/fake/log/path',
            asAbsolutePath: (relativePath: string) => path.resolve('/fake/extension/path', relativePath),
        } as any;
        activate(mockContext);
    });

    suiteTeardown(() => {
        if (deactivate) {
            deactivate();
        }
    });

    setup(() => {
        mockFileContents.clear();
        Object.keys(mockGlobalConfig).forEach(key => delete mockGlobalConfig[key]);
        mockWorkspaceConfig = {};
        mockWorkspaceFolder = {
            uri: vscode.Uri.file(path.resolve('/fake/workspace')),
            name: 'FakeWorkspace',
            index: 0
        };

        mockWebviewPanel = {
            webview: {
                html: '',
            },
        } as any;
        stubs.push(sinon.stub(vscode.window, 'createWebviewPanel').returns(mockWebviewPanel as any));
        stubs.push(sinon.stub(vscode.window, 'showErrorMessage'));

        stubs.push(sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section) => {
            if (section === 'jinjer') {
                return {
                    get: (key: string) => mockGlobalConfig[key] ?? mockWorkspaceConfig[key],
                    has: (key: string) => (key in mockGlobalConfig) || (key in mockWorkspaceConfig),
                    inspect: (key: string) => ({
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
            const filePath = uri.fsPath;
            if (mockFileContents.has(filePath) || filePath === mockWorkspaceFolder?.uri.fsPath) {
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

        nunjucksConfigureSpy = sinon.spy(nunjucks, 'configure');
        spies.push(nunjucksConfigureSpy);

        renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        spies.push(renderStringSpy);
    });

    teardown(async () => {
        stubs.forEach(stub => stub.restore());
        stubs = [];
        spies.forEach(spy => spy.restore());
        spies = [];
    });

    async function setupAndPreview(templateContent: string, templateFileName: string = 'test.jinja') {
        const docUri = vscode.Uri.joinPath(mockWorkspaceFolder!.uri, templateFileName);
        mockFileContents.set(docUri.fsPath, templateContent);

        const mockEditor = {
            document: {
                uri: docUri,
                fileName: docUri.fsPath,
                getText: () => templateContent,
                languageId: 'jinja',
            },
        };

        const activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor').value(mockEditor);
        stubs.push(activeTextEditorStub);

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);
    }

    test('Initial setup - Nunjucks should be configured with global settings', async () => {
        mockGlobalConfig = {
            contextFile: '.jinjer-global.json',
            variableSuffix: 'globalData',
            settingsFile: '.jinjer-settings.json'
        };
        mockFileContents.set(path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer-global.json'), JSON.stringify({ name: "Global Default"}));

        await setupAndPreview('Hello {{ globalData.name }}');

        assert.ok(nunjucksConfigureSpy.called, 'Nunjucks.configure should have been called');
        assert.ok(mockWebviewPanel.webview.html.includes('Hello Global Default'), `HTML was: ${mockWebviewPanel.webview.html}`);
    });

    suite('1. Workspace Settings Override (.jinjer-settings.json)', () => {
        let workspaceSettingsFilePath: string;
        let globalContextFilePath: string;
        let workspaceContextFilePath: string;
        let includeTemplatePath: string;
        const workspaceSearchPath = 'includes';

        setup(() => {
            mockWorkspaceFolder = {
                uri: vscode.Uri.file(path.resolve('/fake/workspace')),
                name: 'FakeWorkspace',
                index: 0
            };
            workspaceSettingsFilePath = path.join(mockWorkspaceFolder.uri.fsPath, '.jinjer-settings.json');
            globalContextFilePath = path.join(mockWorkspaceFolder.uri.fsPath, 'global.context.json');
            workspaceContextFilePath = path.join(mockWorkspaceFolder.uri.fsPath, 'workspace.context.json');
            includeTemplatePath = path.join(mockWorkspaceFolder.uri.fsPath, 'includes', 'included.jinja');

            mockGlobalConfig.contextFile = 'global.context.json';
            mockGlobalConfig.variableSuffix = 'g';
            mockGlobalConfig.customSearchPath = 'global_includes';
            mockGlobalConfig.settingsFile = '.jinjer-settings.json';

            mockFileContents.set(globalContextFilePath, JSON.stringify({ G_data: "From Global Context" }));

            const wsSettings = {
                contextFile: 'workspace.context.json',
                variableSuffix: 'ws',
                customSearchPath: workspaceSearchPath
            };
            mockFileContents.set(workspaceSettingsFilePath, JSON.stringify(wsSettings));
            mockFileContents.set(workspaceContextFilePath, JSON.stringify({ WS_data: "From Workspace Context" }));
            mockFileContents.set(includeTemplatePath, "Included Content (Workspace Path)");
        });

        test('Should use contextFile from workspace settings', async () => {
            await setupAndPreview('Data: {{ ws.WS_data }}');
            assert.ok(
                mockWebviewPanel.webview.html.includes('Data: From Workspace Context'),
                `Expected workspace context, got: ${mockWebviewPanel.webview.html}`
            );
            assert.ok(
                !mockWebviewPanel.webview.html.includes('From Global Context'),
                `Should not have loaded global context data: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should apply variableSuffix from workspace settings', async () => {
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
            await setupAndPreview('{% include "somefile.jinja" %}');

            const configureArgs = nunjucksConfigureSpy.lastCall.args[0];
            const globalPathToAvoid = path.resolve(mockWorkspaceFolder!.uri.fsPath, 'global_includes');

            assert.ok(
                Array.isArray(configureArgs) && !configureArgs.includes(globalPathToAvoid),
                `Nunjucks configure args included global search path when it should have been overridden. Got: ${JSON.stringify(configureArgs)}`
            );
        });
    });

    suite('2. Fallback to Global Settings (No .jinjer-settings.json)', () => {
        let globalContextFilePath: string;
        let globalIncludeTemplatePath: string;
        const globalSearchPath = 'global_includes_fallback';

        setup(() => {
            mockWorkspaceFolder = {
                uri: vscode.Uri.file(path.resolve('/fake/workspace')),
                name: 'FakeWorkspace',
                index: 0
            };
            globalContextFilePath = path.join(mockWorkspaceFolder.uri.fsPath, 'global-fallback.context.json');
            globalIncludeTemplatePath = path.join(mockWorkspaceFolder.uri.fsPath, 'global_includes_fallback', 'included_fallback.jinja');

            mockFileContents.delete(path.join(mockWorkspaceFolder.uri.fsPath, '.jinjer-settings.json'));

            Object.keys(mockGlobalConfig).forEach(key => delete mockGlobalConfig[key]);
            mockGlobalConfig.contextFile = 'global-fallback.context.json';
            mockGlobalConfig.variableSuffix = 'gFallback';
            mockGlobalConfig.customSearchPath = globalSearchPath;
            mockGlobalConfig.settingsFile = '.jinjer-settings.json';

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

    suite('3. customSearchPath Variations (via .jinjer-settings.json)', () => {
        let workspaceSettingsFilePath: string;
        const includeDir1 = 'custom_includes_1';
        const includeDir2 = 'custom_includes_2';
        let includeFile1Path: string;
        let includeFile2Path: string;
        let relativeIncludeFileOuterPath: string;
        let resolvedRelativeOuterPath: string;

        setup(() => {
            mockWorkspaceFolder = {
                uri: vscode.Uri.file(path.resolve('/fake/workspace')),
                name: 'FakeWorkspace',
                index: 0
            };
            workspaceSettingsFilePath = path.join(mockWorkspaceFolder.uri.fsPath, '.jinjer-settings.json');
            includeFile1Path = path.join(mockWorkspaceFolder.uri.fsPath, includeDir1, 'file1.jinja');
            includeFile2Path = path.join(mockWorkspaceFolder.uri.fsPath, includeDir2, 'file2.jinja');
            relativeIncludeFileOuterPath = path.join(mockWorkspaceFolder.uri.fsPath, '..', 'shared_templates', 'outer_shared.jinja');
            resolvedRelativeOuterPath = path.resolve(mockWorkspaceFolder.uri.fsPath, '..', 'shared_templates', 'outer_shared.jinja');

            Object.keys(mockGlobalConfig).forEach(key => delete mockGlobalConfig[key]);
            mockGlobalConfig.settingsFile = '.jinjer-settings.json';
            mockFileContents.set(path.join(mockWorkspaceFolder!.uri.fsPath, '.jinjer.json'), JSON.stringify({ msg: "default" }));
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

            assert.ok(
                Array.isArray(configureArgs) && configureArgs.includes(expectedSearchPath1), `Nunjucks not configured with first custom path. Got: ${JSON.stringify(configureArgs)}`);
            assert.ok(Array.isArray(configureArgs) && configureArgs.includes(expectedSearchPath2), `Nunjucks not configured with second custom path. Got: ${JSON.stringify(configureArgs)}`);
            assert.ok(mockWebviewPanel.webview.html.includes("Content from dir1"), `HTML missing content from dir1: ${mockWebviewPanel.webview.html}`);
            assert.ok(mockWebviewPanel.webview.html.includes("Content from dir2"), `HTML missing content from dir2: ${mockWebviewPanel.webview.html}`);
        });

        test('3.3 Should correctly resolve relative paths like `../` in customSearchPath', async () => {
            const relativePath = '../shared_templates';
            const wsSettings = { customSearchPath: [relativePath] };
            mockFileContents.set(workspaceSettingsFilePath, JSON.stringify(wsSettings));
            mockFileContents.set(resolvedRelativeOuterPath, "Content from ../shared_templates/outer_shared.jinja");

            await setupAndPreview('{% include "outer_shared.jinja" %}');

            const expectedSearchPath = resolvedRelativeOuterPath.substring(0, resolvedRelativeOuterPath.lastIndexOf(path.sep));
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

    suite('4. No Settings File and No Global Config (Defaults)', () => {
        let defaultContextFilePath: string;
        let localIncludeFilePath: string;

        setup(() => {
            mockWorkspaceFolder = {
                uri: vscode.Uri.file(path.resolve('/fake/workspace')),
                name: 'FakeWorkspace',
                index: 0
            };
            defaultContextFilePath = path.join(mockWorkspaceFolder.uri.fsPath, '.jinjer.json');
            localIncludeFilePath = path.join(mockWorkspaceFolder.uri.fsPath, 'local_include.jinja');

            mockFileContents.delete(path.join(mockWorkspaceFolder.uri.fsPath, '.jinjer-settings.json'));

            Object.keys(mockGlobalConfig).forEach(key => delete mockGlobalConfig[key]);
            mockGlobalConfig.contextFile = undefined;
            mockGlobalConfig.variableSuffix = undefined;
            mockGlobalConfig.customSearchPath = undefined;

            mockFileContents.set(defaultContextFilePath, JSON.stringify({ default_data: "From Default .jinjer.json" }));
            mockFileContents.set(localIncludeFilePath, "Locally Included Content");
        });

        test('Should use default context file name ".jinjer.json"', async () => {
            await setupAndPreview('Data: {{ default_data }}');
            assert.ok(
                mockWebviewPanel.webview.html.includes('Data: From Default .jinjer.json'),
                `Expected data from default .jinjer.json, got: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should apply no variableSuffix by default (or extension default)', async () => {
            await setupAndPreview('No Suffix Test: {{ default_data }}');
            assert.ok(
                mockWebviewPanel.webview.html.includes('No Suffix Test: From Default .jinjer.json'),
                `No suffix should be applied by default: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should allow includes relative to the template file itself', async () => {
            await setupAndPreview('Include Test: {% include "local_include.jinja" %}');

            const configureArgs = nunjucksConfigureSpy.lastCall.args[0];
            const expectedTemplateDir = path.dirname(path.join(mockWorkspaceFolder!.uri.fsPath, 'test.jinja'));

            assert.ok(
                Array.isArray(configureArgs) && configureArgs.length > 0 && configureArgs.includes(expectedTemplateDir),
                `Nunjucks configure args should include current template's directory. Got: ${JSON.stringify(configureArgs)}`
            );
            const filteredConfigureArgs = configureArgs.filter((p: string | undefined) => p !== undefined && p !== null);
            assert.strictEqual(filteredConfigureArgs.length, 1, `Expected only template directory in search paths. Got: ${JSON.stringify(filteredConfigureArgs)}`);

            assert.ok(
                mockWebviewPanel.webview.html.includes('Include Test: Locally Included Content'),
                `Local include failed: ${mockWebviewPanel.webview.html}`
            );
        });

        test('Should handle missing context file gracefully (render with empty context)', async () => {
            mockFileContents.delete(defaultContextFilePath);
            await setupAndPreview('Hello {{ name }}');
            assert.ok(
                mockWebviewPanel.webview.html.includes('Hello <!-- name -->') || mockWebviewPanel.webview.html.includes('Hello <span class="jinja-error">name is undefined</span>') || mockWebviewPanel.webview.html.includes('Hello '),
                `Expected graceful render with missing context. Got: ${mockWebviewPanel.webview.html}`
            );
            assert.ok((vscode.window.showErrorMessage as sinon.SinonStub).calledWith(sinon.match(/Context file ".*?" not found/)),
                "showErrorMessage should have been called for missing context file");
        });
    });
});

suite('Context Inclusion Tests (New)', () => {
    let testSuiteStubs: sinon.SinonStub[] = [];
    let testSuiteSpies: sinon.SinonSpy[] = [];
    const mockFileContents = new Map<string, string>();
    const mockJinjerConfig: { [key: string]: any } = {};
    let mockWorkspaceFolder: vscode.WorkspaceFolder;
    const testFixtureRoot = path.resolve('/fake/workspace/contextIncludes');
    const getFixtureUri = (fileName: string) => vscode.Uri.file(path.join(testFixtureRoot, fileName));
    let activeTextEditorStub: sinon.SinonStub | undefined = undefined;

    let renderStringSpy: sinon.SinonSpy;
    let consoleWarnSpy: sinon.SinonSpy;
    let nunjucksConfigureSpy: sinon.SinonSpy;
    let mockContext: vscode.ExtensionContext;

    suiteSetup(async () => {
        mockContext = {
            subscriptions: [],
            workspaceState: { get: () => {}, update: () => Promise.resolve(), keys: () => [] } as vscode.Memento,
            globalState: { get: () => {}, update: () => Promise.resolve(), keys: () => [] } as vscode.Memento,
            extensionPath: '/fake/extension/path',
            storagePath: '/fake/storage/path',
            logPath: '/fake/log/path',
            asAbsolutePath: (relativePath: string) => path.resolve('/fake/extension/path', relativePath),
        } as any;
        if (activate) {
            await activate(mockContext);
        }
    });

    suiteTeardown(() => {
        if (deactivate) {
            deactivate();
        }
    });

    setup(async () => {
        mockFileContents.clear();
        Object.keys(mockJinjerConfig).forEach(key => delete mockJinjerConfig[key]);
        mockJinjerConfig.contextIncludeKey = '_jinjer_include_contexts';
        mockJinjerConfig.contextFile = 'context.json';
        mockJinjerConfig.variableSuffix = '';

        mockWorkspaceFolder = {
            uri: vscode.Uri.file(testFixtureRoot),
            name: 'ContextIncludesTestWorkspace',
            index: 0
        };

        const getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section) => {
            if (section === 'jinjer') {
                return {
                    get: (key: string) => mockJinjerConfig[key],
                    has: (key: string) => key in mockJinjerConfig,
                    inspect: (key: string) => ({ key: `jinjer.${key}`, globalValue: mockJinjerConfig[key], defaultValue: undefined, workspaceValue: undefined, globalLanguageValue: undefined, workspaceFolderValue: undefined, workspaceFolderLanguageValue: undefined, languageIds: undefined}),
                    update: sinon.stub().callsFake(async (key:string, value:any) => { mockJinjerConfig[key] = value; return Promise.resolve(); })
                };
            }
            return {
                get: sinon.stub().returns(undefined),
                has: sinon.stub().returns(false),
                inspect: sinon.stub().returns(undefined),
                update: sinon.stub().resolves()
            } as any;
        });
        testSuiteStubs.push(getConfigurationStub);

        const readFileStub = sinon.stub(vscode.workspace.fs, 'readFile').callsFake(async (uri: vscode.Uri) => {
            const filePath = uri.fsPath;
            if (mockFileContents.has(filePath)) {
                return Buffer.from(mockFileContents.get(filePath)!);
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        });
        testSuiteStubs.push(readFileStub);

        const statStub = sinon.stub(vscode.workspace.fs, 'stat').callsFake(async (uri: vscode.Uri) => {
            const filePath = uri.fsPath;
            if (filePath === mockWorkspaceFolder.uri.fsPath) {
                return {
                    type: vscode.FileType.Directory,
                    size: 0,
                    mtime: Date.now(),
                    ctime: Date.now()
                } as vscode.FileStat;
            }
            if (mockFileContents.has(filePath)) {
                return {
                    type: vscode.FileType.File,
                    size: mockFileContents.get(filePath)?.length || 0,
                    mtime: Date.now(),
                    ctime: Date.now()
                } as vscode.FileStat;
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        });
        testSuiteStubs.push(statStub);

        const getWorkspaceFolderStub = sinon.stub(vscode.workspace, 'getWorkspaceFolder').returns(mockWorkspaceFolder);
        testSuiteStubs.push(getWorkspaceFolderStub);

        const dummyDocUri = vscode.Uri.joinPath(mockWorkspaceFolder.uri, 'dummy_template_new.j2');
        const mockEditor = {
            document: { uri: dummyDocUri, fileName: dummyDocUri.fsPath, getText: () => "" }
        };
        if (activeTextEditorStub && typeof activeTextEditorStub.restore === 'function') {
            activeTextEditorStub.restore();
        }
        activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor').returns(mockEditor as any);
        testSuiteStubs.push(activeTextEditorStub);

        const createWebviewPanelStub = sinon.stub(vscode.window, 'createWebviewPanel').returns({
            webview: {
                html: '',
                asWebviewUri: (uri: vscode.Uri) => uri,
            },
            reveal: sinon.stub(),
            onDidDispose: sinon.stub(),
        } as any);
        testSuiteStubs.push(createWebviewPanelStub);

        consoleWarnSpy = sinon.spy(console, 'warn');
        testSuiteSpies.push(consoleWarnSpy);

        renderStringSpy = sinon.spy(nunjucks.Environment.prototype, 'renderString');
        testSuiteSpies.push(renderStringSpy);

        nunjucksConfigureSpy = sinon.spy(nunjucks, 'configure');
        testSuiteSpies.push(nunjucksConfigureSpy);
    });

    teardown(async () => {
        testSuiteStubs.forEach(s => s.restore());
        testSuiteStubs = [];
        testSuiteSpies.forEach(s => s.restore());
        testSuiteSpies = [];

        activeTextEditorStub = undefined;
    });

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

        if (activeTextEditorStub && typeof activeTextEditorStub.restore === 'function') {
            activeTextEditorStub.restore();
        }
        const dummyInBaseDocUri = getFixtureUri('base/dummy_in_base.j2');
        activeTextEditorStub = sinon.stub(vscode.window, 'activeTextEditor').returns({
            document: { uri: dummyInBaseDocUri, fileName: dummyInBaseDocUri.fsPath, getText: () => "" }
        } as any);
        testSuiteStubs.push(activeTextEditorStub);

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
        mockFileContents.set(includePathString, JSON.stringify(absoluteTargetContent));

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
        const getWorkspaceFolderStubInstance = testSuiteStubs.find(s => s.name === 'getWorkspaceFolder');
        if (getWorkspaceFolderStubInstance && (getWorkspaceFolderStubInstance as sinon.SinonStub).name === 'getWorkspaceFolder') {
            (getWorkspaceFolderStubInstance as sinon.SinonStub).returns(undefined);
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
        mockJinjerConfig.contextFile = 'main_empty_yaml_include.json';

        const mainContent = {
            "message": "Main context",
            "_jinjer_include_contexts": [
                "./data_before_empty.json",
                "./empty.yaml",
                "./data_after_empty.json"
            ]
        };
        const dataBeforeContent = {
            "data_before": "This data should persist",
            "shared_key": "from_before"
        };
        const emptyYamlContent = "# This YAML is empty";
        const dataAfterContent = {
            "data_after": "This data should also be present",
            "shared_key": "from_after"
        };

        mockFileContents.set(getFixtureUri('main_empty_yaml_include.json').fsPath, JSON.stringify(mainContent));
        mockFileContents.set(getFixtureUri('data_before_empty.json').fsPath, JSON.stringify(dataBeforeContent));
        mockFileContents.set(getFixtureUri('empty.yaml').fsPath, emptyYamlContent);
        mockFileContents.set(getFixtureUri('data_after_empty.json').fsPath, JSON.stringify(dataAfterContent));

        await vscode.commands.executeCommand('jinjer.preview');
        await delay(100);

        assert.ok(renderStringSpy.called, 'Nunjucks renderString was not called');

        const contextUsedByNunjucks = renderStringSpy.lastCall.args[1];

        const expectedContext = {
            "message": "Main context",
            "data_before": "This data should persist",
            "data_after": "This data should also be present",
            "shared_key": "from_after",
            "_jinjer_include_contexts": [
                "./data_before_empty.json",
                "./empty.yaml",
                "./data_after_empty.json"
            ]
        };

        assert.deepStrictEqual(contextUsedByNunjucks, expectedContext, "Context was not merged correctly with an empty YAML include.");

        assert.ok(
            consoleWarnSpy.calledWith(sinon.match(/YAML context file .*empty.yaml is empty or contains only comments. Returning empty object./)),
            "Expected console.warn for empty YAML file."
        );
    });
});
