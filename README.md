# jinjer Jinja Previewer for VS Code

Preview Jinja templates directly within VS Code. This extension leverages a built-in webview to render Jinja templates, simplifying the development process and eliminating the need for constant browser refreshes.

## Features

* Live Preview: See your Jinja templates rendered in real-time as you edit them. Changes are reflected instantly in the preview pane.
* Context Support: Define context variables within a dedicated configuration file to populate your templates with dynamic data. The extension supports JSON and YAML for defining context.
* Customizable Settings: Tailor the preview behavior to your preferences using global, workspace, or per-workspace settings files.
* Error Reporting: Clear error messages are displayed in the preview pane if issues occur during template rendering.
* Support for Includes and Macros: Preview Jinja templates that leverage includes, extends, and macros, with configurable search paths.

## Configuration

This extension offers several settings to customize its behavior. Settings can be configured at different levels, providing flexibility for individual preferences and project-specific requirements.

### Configuration Precedence

Jinjer resolves settings in the following order (highest precedence first):

1. **Per-Workspace Settings File** (e.g., `.jinjer-settings.json` in the workspace root, name configurable via `jinjer.settingsFile`)
2. **VS Code Workspace Settings** (defined in `.vscode/settings.json`)
3. **VS Code User (Global) Settings** (defined in your global `settings.json`)

This ensures that the most specific configuration for your project is always applied.

### VS Code Settings (User and Workspace Level)

You can configure the following settings directly in your VS Code `settings.json` (accessible via `Preferences: Open Settings (JSON)` or `Preferences: Open Workspace Settings (JSON)`):

* **`jinjer.contextFile`**:
  * Description: The name of the context file (JSON or YAML) to use for rendering Jinja templates. If the file is not found in the same directory as the template, parent directories will be searched up to the workspace root.
  * Default: `".jinjer.json"`
* **`jinjer.variableSuffix`**:
  * Description: If set (e.g., `"mydata"`), the context data will be wrapped under this key. For example, with `variableSuffix = "mydata"`, a template using `{{ mydata.variable }}` will render using the value from the context file key `"variable"`. An empty string means no suffix is applied.
  * Default: `""` (empty string)
* **`jinjer.customSearchPath`**:
  * Description: A string or an array of strings representing paths where Nunjucks (the Jinja engine) should look for templates during `{% include %}`, `{% extends %}`, or `{% import %}` operations. Paths should be relative to the workspace root. These are added to Nunjucks's search paths, which always includes the directory of the current template file by default.
  * Default: `undefined` (Nunjucks only searches relative to the current file)
* **`jinjer.settingsFile`**:
  * Description: Defines the name of the JSON file to be used for per-workspace Jinjer settings. This file allows for more granular, project-specific configurations that can be version-controlled.
  * Default: `".jinjer-settings.json"`
* **`jinjer.contextIncludeKey`**:
  * Description: Specifies a key within your JSON/YAML context files that lists other context files to be included and merged. Paths are resolved relative to the file containing this key, or can be absolute. Set to a string like `"_jinjer_include_contexts"` (default) or `null`/empty string to disable.
  * Default: `"_jinjer_include_contexts"`

### Per-Workspace Settings File

For project-specific configurations that can be shared across a team or version-controlled, you can use a dedicated settings file in your workspace root. The name of this file is determined by the `jinjer.settingsFile` VS Code setting (defaulting to `.jinjer-settings.json`).

This JSON file can contain the following properties:

* **`contextFile`**:
  * Type: `string`
  * Description: Path to your context data file (JSON or YAML), relative to the workspace root. This overrides the `jinjer.contextFile` setting from VS Code's global or workspace settings.
  * Example: `"src/data/template-context.yaml"`
* **`variableSuffix`**:
  * Type: `string`
  * Description: A string under which your context variables will be namespaced (e.g., `"cc"` for `{{ cc.variable }}`). An empty string (`""`) means no namespacing. This overrides the `jinjer.variableSuffix` from VS Code settings.
  * Example: `"page_data"`
* **`customSearchPath`**:
  * Type: `string | string[]`
  * Description: A path or an array of paths (relative to the workspace root) where Nunjucks should look for templates during `{% include %}`, `{% extends %}`, or `{% import %}` operations. These paths are added to Nunjucks's search list. This overrides the `jinjer.customSearchPath` from VS Code settings.
  * Example (single path): `"templates/includes"`
  * Example (multiple paths): `["includes/", "shared_components/jinja"]`

#### Example `.jinjer-settings.json`

```json
{
  "contextFile": "src/data/context.json",
  "variableSuffix": "site",
  "customSearchPath": [
    "src/templates/includes",
    "src/templates/layouts"
  ]
}
```

#### Benefits of Per-Workspace Settings

* **Project-Specific Configurations**: Tailor Jinjer's behavior to the specific needs and directory structure of each project.
* **Team Collaboration**: Share consistent rendering settings across a team by committing this file to version control.
* **Simplified Setup**: New contributors can get started quickly with pre-defined project settings, ensuring consistent preview behavior.

### Including Other Context Files

To better organize and reuse context data, Jinjer allows you to include other context files from within a primary context file. This feature is controlled by the `jinjer.contextIncludeKey` setting.

By default, if your context file (e.g., `.jinjer.json`) contains a key named `_jinjer_include_contexts` (or whatever you've configured `jinjer.contextIncludeKey` to be), the extension will look for an array of file paths under that key. These specified files will be read, parsed (as JSON or YAML based on their extension), and their content will be deep-merged into the parent context.

**Example:**

Suppose `jinjer.contextIncludeKey` is set to its default, `"_jinjer_include_contexts"`.

Your main context file, e.g., `template.context.json`:
```json
{
  "pageTitle": "My Awesome Page",
  "featureFlags": {
    "newNav": true,
    "betaFeature": false
  },
  "_jinjer_include_contexts": [
    "../shared/site-common.json",
    "override-settings.yaml"
  ],
  "specificValue": "This is from the main context file."
}
```

`../shared/site-common.json`:
```json
{
  "siteName": "Our Cool Site",
  "featureFlags": {
    "betaFeature": true,
    "analytics": true
  }
}
```

`override-settings.yaml`:
```yaml
featureFlags:
  newNav: false # This will override the value from main context
contactEmail: support@example.com
```

**Resulting Merged Context:**
```json
{
  "pageTitle": "My Awesome Page",
  "featureFlags": {
    "newNav": false,       // from override-settings.yaml
    "betaFeature": true,   // from site-common.json (merged first, then override-settings.yaml, but site-common had it last for this key) - actually, it should be from site-common.
                           // Correction: parent -> include1 -> include2. So override-settings.yaml's betaFeature: true would be overridden by site-common.json if order was swapped.
                           // With current order: parent -> site-common -> override.
                           // parent.newNav=true. site-common has no newNav. override.newNav=false. So newNav=false.
                           // parent.betaFeature=false. site-common.betaFeature=true. override has no betaFeature. So betaFeature=true.
    "analytics": true      // from site-common.json
  },
  "siteName": "Our Cool Site", // from site-common.json
  "contactEmail": "support@example.com", // from override-settings.yaml
  "specificValue": "This is from the main context file.",
  "_jinjer_include_contexts": [ // This key also remains, as per current merge logic
    "../shared/site-common.json",
    "override-settings.yaml"
  ]
}
```
*(The example merge logic for `featureFlags.betaFeature` was slightly off in the thought process, the final JSON reflects the correct last-win outcome based on include order)*

**Key Behaviors:**

*   **Path Resolution:** Paths to included files are resolved relative to the directory of the file containing the include directive. Absolute paths are also supported and used as-is.
*   **Deep Merging:** Included files are deep-merged into the parent context. Merging occurs sequentially based on the order in the include array.
*   **Conflict Resolution:** If multiple files (including the parent) define the same key, the value from the file processed later takes precedence (i.e., includes overwrite the parent, and later includes overwrite earlier ones for the same keys at the same level).
*   **File Types:** Both JSON and YAML files can be included, regardless of the parent file's type. The extension determines the type based on the included file's extension (`.json`, `.yaml`, `.yml`).
*   **Circular Dependencies:** Circular includes (e.g., File A includes File B, and File B includes File A) are detected and handled by not re-processing a file that is already in the current chain of includes. A warning is logged in such cases.
*   **Disabling:** Setting `jinjer.contextIncludeKey` to `null` or an empty string will disable this feature.

## Known Issues

* Complex Jinja features that rely on external Python dependencies or system-level access might not be fully supported within the preview, as it uses Nunjucks (a JavaScript port of Jinja).
* Performance might be affected when working with very large or complex templates.

## Release Notes

See the CHANGELOG for the latest release notes.

## Contributing

Contributions are welcome! Feel free to open issues and submit pull requests.

## License

This extension is licensed under the MIT License.
