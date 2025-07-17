import * as assert from 'assert';
import * as nunjucks from 'nunjucks';

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
