const test = require('node:test');
const assert = require('node:assert/strict');
const { applyImmersiveDisplay } = require('../plugins/withImmersiveDisplay.cjs');

test('immersive config survives prebuild and is idempotent', () => {
  const source = 'class MainActivity : ReactActivity() {\n}';
  const result = applyImmersiveDisplay(source);
  assert.match(result, /BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/);
  assert.match(result, /override fun onResume/);
  assert.match(result, /override fun onWindowFocusChanged/);
  assert.equal(applyImmersiveDisplay(result), result);
});

test('immersive config refuses to overwrite existing lifecycle handling', () => {
  assert.throws(() => applyImmersiveDisplay('class MainActivity : ReactActivity() {\n override fun onResume() {}\n}'));
});
