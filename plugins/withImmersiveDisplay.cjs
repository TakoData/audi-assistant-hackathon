const { withMainActivity } = require('expo/config-plugins');

const methods = `
  // Audi demo: retain immersive mode after permissions, keyboard and resume.
  private fun hideDemoSystemBars() {
    val controller = androidx.core.view.WindowCompat.getInsetsController(window, window.decorView)
    controller.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
  }

  override fun onResume() {
    super.onResume()
    window.decorView.post { hideDemoSystemBars() }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) window.decorView.post { hideDemoSystemBars() }
  }
`;

function applyImmersiveDisplay(source) {
  if (source.includes('private fun hideDemoSystemBars()')) return source;
  const anchor = 'class MainActivity : ReactActivity() {';
  if (!source.includes(anchor) || /override fun (onResume|onWindowFocusChanged)\(/.test(source)) {
    throw new Error('Review MainActivity lifecycle before adding immersive mode.');
  }
  return source.replace(anchor, anchor + '\n' + methods);
}

module.exports = config => withMainActivity(config, config => {
  if (config.modResults.language !== 'kt') throw new Error('Immersive display requires Kotlin MainActivity.');
  config.modResults.contents = applyImmersiveDisplay(config.modResults.contents);
  return config;
});
module.exports.applyImmersiveDisplay = applyImmersiveDisplay;
