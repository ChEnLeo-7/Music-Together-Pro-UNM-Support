package app.musictogether.android

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity : ComponentActivity() {
  private var webView: WebView? = null

  private val playbackEvents = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val payload = intent?.getStringExtra(PlaybackService.EXTRA_EVENT) ?: return
      webView?.post {
        webView?.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('music-together-native-playback',{detail:$payload}))",
          null,
        )
      }
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showServerPicker()

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val browser = webView
        when {
          browser == null -> finish()
          browser.canGoBack() -> browser.goBack()
          else -> showServerPicker()
        }
      }
    })
  }

  private fun openServer(serverUrl: String) {
    getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().putString(SERVER_URL, serverUrl).apply()
    requestNotificationPermission()
    webView?.destroy()
    webView = WebView(this).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.mediaPlaybackRequiresUserGesture = false
      settings.userAgentString = "${settings.userAgentString} MusicTogetherAndroid/1"
      webViewClient = WebViewClient()
      webChromeClient = WebChromeClient()
      addJavascriptInterface(PlaybackBridge(this@MainActivity), "MusicTogetherAndroid")
      loadUrl(serverUrl)
    }
    setContentView(webView)
  }

  private fun showServerPicker() {
    webView?.apply {
      removeJavascriptInterface("MusicTogetherAndroid")
      destroy()
    }
    webView = null

    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(28), dp(48), dp(28), dp(32))
    }
    val title = TextView(this).apply {
      text = getString(R.string.server_title)
      textSize = 28f
      setTextColor(Color.WHITE)
      setTypeface(typeface, Typeface.BOLD)
    }
    val description = TextView(this).apply {
      text = getString(R.string.server_description)
      textSize = 15f
      setTextColor(Color.rgb(190, 190, 205))
      gravity = Gravity.CENTER
      setPadding(0, dp(12), 0, dp(32))
    }
    val label = TextView(this).apply {
      text = getString(R.string.server_address_label)
      textSize = 14f
      setTextColor(Color.rgb(225, 225, 235))
      setTypeface(typeface, Typeface.BOLD)
    }
    val address = EditText(this).apply {
      hint = getString(R.string.server_address_hint)
      setText(getSharedPreferences(PREFERENCES, MODE_PRIVATE).getString(SERVER_URL, ""))
      setTextColor(Color.WHITE)
      setHintTextColor(Color.rgb(125, 125, 145))
      textSize = 16f
      setSingleLine(true)
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
      imeOptions = EditorInfo.IME_ACTION_GO
      setPadding(dp(16), dp(4), dp(16), dp(4))
      background = roundedBackground(Color.rgb(31, 31, 39), Color.rgb(78, 78, 96), 12f)
    }
    val error = TextView(this).apply {
      text = getString(R.string.server_invalid)
      textSize = 13f
      setTextColor(Color.rgb(248, 113, 113))
      setPadding(dp(4), dp(8), 0, 0)
      visibility = View.GONE
    }
    val connect = Button(this).apply {
      text = getString(R.string.server_connect)
      textSize = 16f
      setTextColor(Color.WHITE)
      isAllCaps = false
      background = roundedBackground(Color.rgb(124, 58, 237), Color.TRANSPARENT, 12f)
    }
    val privacy = TextView(this).apply {
      text = getString(R.string.server_privacy)
      textSize = 12f
      gravity = Gravity.CENTER
      setTextColor(Color.rgb(135, 135, 155))
      setPadding(0, dp(24), 0, 0)
    }

    val connectToServer = {
      val normalized = normalizeServerUrl(address.text.toString())
      if (normalized == null) {
        error.visibility = View.VISIBLE
      } else {
        error.visibility = View.GONE
        openServer(normalized)
      }
    }
    connect.setOnClickListener { connectToServer() }
    address.setOnEditorActionListener { _, actionId, _ ->
      if (actionId == EditorInfo.IME_ACTION_GO) {
        connectToServer()
        true
      } else false
    }

    content.addView(title)
    content.addView(description, matchWrap())
    content.addView(label, matchWrap())
    content.addView(address, matchHeight(dp(56), top = dp(8)))
    content.addView(error, matchWrap())
    content.addView(connect, matchHeight(dp(52), top = dp(20)))
    content.addView(privacy, matchWrap())

    setContentView(ScrollView(this).apply {
      setBackgroundColor(Color.rgb(9, 9, 11))
      isFillViewport = true
      addView(content, matchHeight(LinearLayout.LayoutParams.MATCH_PARENT))
    })
    address.requestFocus()
  }

  override fun onStart() {
    super.onStart()
    ContextCompat.registerReceiver(
      this,
      playbackEvents,
      IntentFilter(PlaybackService.ACTION_PLAYBACK_EVENT),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
  }

  override fun onStop() {
    unregisterReceiver(playbackEvents)
    super.onStop()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    outState.putString(STATE_URL, webView?.url)
    super.onSaveInstanceState(outState)
  }

  override fun onDestroy() {
    webView?.removeJavascriptInterface("MusicTogetherAndroid")
    webView?.destroy()
    super.onDestroy()
  }

  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }
  }

  private fun normalizeServerUrl(raw: String): String? {
    val value = raw.trim().trimEnd('/')
    if (value.isBlank()) return null
    val withScheme = if ("://" in value) value else "http://$value"
    val uri = runCatching { Uri.parse(withScheme) }.getOrNull() ?: return null
    if (uri.scheme !in setOf("http", "https") || uri.host.isNullOrBlank()) return null
    return uri.toString().trimEnd('/')
  }

  private fun roundedBackground(fill: Int, stroke: Int, radius: Float) = GradientDrawable().apply {
    shape = GradientDrawable.RECTANGLE
    setColor(fill)
    cornerRadius = dp(radius.toInt()).toFloat()
    if (stroke != Color.TRANSPARENT) setStroke(dp(1), stroke)
  }

  private fun matchWrap() = LinearLayout.LayoutParams(
    LinearLayout.LayoutParams.MATCH_PARENT,
    LinearLayout.LayoutParams.WRAP_CONTENT,
  )

  private fun matchHeight(height: Int, top: Int = 0) = LinearLayout.LayoutParams(
    LinearLayout.LayoutParams.MATCH_PARENT,
    height,
  ).apply { topMargin = top }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private inner class PlaybackBridge(private val context: Context) {
    @JavascriptInterface
    fun configureSession(config: String) {
      val json = JSONObject(config)
      val cookie = CookieManager.getInstance().getCookie(json.getString("serverUrl")) ?: ""
      send(PlaybackService.ACTION_CONFIGURE) {
        putExtra(PlaybackService.EXTRA_CONFIG, config)
        putExtra(PlaybackService.EXTRA_COOKIE, cookie)
      }
    }

    @JavascriptInterface
    fun loadSource(source: String, mimeType: String, metadata: String) = send(PlaybackService.ACTION_LOAD) {
      putExtra(PlaybackService.EXTRA_SOURCE, source)
      putExtra(PlaybackService.EXTRA_MIME_TYPE, mimeType)
      putExtra(PlaybackService.EXTRA_METADATA, metadata)
    }

    @JavascriptInterface fun play() = send(PlaybackService.ACTION_PLAY)
    @JavascriptInterface fun pause() = send(PlaybackService.ACTION_PAUSE)
    @JavascriptInterface fun seek(positionSeconds: Double) = send(PlaybackService.ACTION_SEEK) {
      putExtra(PlaybackService.EXTRA_POSITION, (positionSeconds * 1000).toLong())
    }
    @JavascriptInterface fun getPosition(): Double = PlaybackService.snapshot.positionMs / 1000.0
    @JavascriptInterface fun getDuration(): Double = PlaybackService.snapshot.durationMs / 1000.0
    @JavascriptInterface fun isPlaying(): Boolean = PlaybackService.snapshot.isPlaying
    @JavascriptInterface fun setVolume(volume: Double) = send(PlaybackService.ACTION_VOLUME) {
      putExtra(PlaybackService.EXTRA_VOLUME, volume.toFloat())
    }
    @JavascriptInterface fun getVolume(): Double = PlaybackService.snapshot.volume.toDouble()
    @JavascriptInterface fun setRate(rate: Double) = send(PlaybackService.ACTION_RATE) {
      putExtra(PlaybackService.EXTRA_RATE, rate.toFloat())
    }
    @JavascriptInterface fun getRate(): Double = PlaybackService.snapshot.rate.toDouble()
    @JavascriptInterface fun releaseSource(source: String) = send(PlaybackService.ACTION_RELEASE_SOURCE) {
      putExtra(PlaybackService.EXTRA_SOURCE, source)
    }

    private fun send(action: String, extras: Intent.() -> Unit = {}) {
      context.startService(Intent(context, PlaybackService::class.java).setAction(action).apply(extras))
    }
  }

  companion object {
    private const val STATE_URL = "url"
    private const val PREFERENCES = "music-together"
    private const val SERVER_URL = "server-url"
  }
}
