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
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
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
    val savedUrl = savedInstanceState?.getString(STATE_URL)
    val savedServer = getSharedPreferences(PREFERENCES, MODE_PRIVATE).getString(SERVER_URL, null)
    if (!savedUrl.isNullOrBlank() && !savedServer.isNullOrBlank()) {
      openServer(savedServer, savedUrl)
    } else {
      showServerPicker()
    }

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

  private fun openServer(serverUrl: String, initialUrl: String = serverUrl) {
    getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().putString(SERVER_URL, serverUrl).apply()
    requestNotificationPermission()
    webView?.destroy()
    webView = WebView(this).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.mediaPlaybackRequiresUserGesture = false
      settings.userAgentString = "${settings.userAgentString} MusicTogetherAndroid/1"
      webViewClient = object : WebViewClient() {
        private val trusted = Uri.parse(serverUrl)

        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
          val target = request?.url ?: return true
          if (!request.isForMainFrame) return false
          if (sameOrigin(target, trusted)) return false
          runCatching { startActivity(Intent(Intent.ACTION_VIEW, target)) }
          return true
        }
      }
      webChromeClient = WebChromeClient()
      addJavascriptInterface(PlaybackBridge(this@MainActivity, serverUrl), "MusicTogetherAndroid")
      loadUrl(if (sameOrigin(Uri.parse(initialUrl), Uri.parse(serverUrl))) initialUrl else serverUrl)
    }
    setSafeContent(webView ?: return)
  }

  private fun showServerPicker() {
    if (webView != null) {
      startService(Intent(this, PlaybackService::class.java).setAction(PlaybackService.ACTION_RELEASE_SESSION))
    }
    webView?.apply {
      removeJavascriptInterface("MusicTogetherAndroid")
      destroy()
    }
    webView = null

    val horizontalGutter = if (resources.configuration.smallestScreenWidthDp >= 600) dp(96) else dp(24)
    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(horizontalGutter, dp(32), horizontalGutter, dp(32))
    }
    val logo = MaterialCardView(this).apply {
      radius = dp(24).toFloat()
      cardElevation = 0f
      setCardBackgroundColor(Color.rgb(35, 35, 35))
      addView(ImageView(this@MainActivity).apply {
        setImageResource(R.drawable.ic_headphones)
        contentDescription = null
        setPadding(dp(16), dp(16), dp(16), dp(16))
      }, FrameLayout.LayoutParams(dp(72), dp(72)))
    }
    val eyebrow = TextView(this).apply {
      text = getString(R.string.server_eyebrow)
      textSize = 12f
      letterSpacing = 0.18f
      setTextColor(Color.rgb(208, 188, 255))
      setTypeface(typeface, Typeface.BOLD)
    }
    val title = TextView(this).apply {
      text = getString(R.string.server_title)
      textSize = 32f
      setTextColor(Color.rgb(230, 224, 233))
      setTypeface(typeface, Typeface.BOLD)
    }
    val description = TextView(this).apply {
      text = getString(R.string.server_description)
      textSize = 16f
      setTextColor(Color.rgb(202, 196, 208))
      setLineSpacing(0f, 1.25f)
    }
    val address = TextInputEditText(this).apply {
      setText(getSharedPreferences(PREFERENCES, MODE_PRIVATE).getString(SERVER_URL, ""))
      setTextColor(Color.rgb(230, 224, 233))
      setHintTextColor(Color.rgb(147, 143, 153))
      textSize = 16f
      setSingleLine(true)
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
      imeOptions = EditorInfo.IME_ACTION_GO
    }
    val addressField = TextInputLayout(this).apply {
      hint = getString(R.string.server_address_label)
      placeholderText = getString(R.string.server_address_hint)
      helperText = getString(R.string.server_address_helper)
      boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
      boxBackgroundColor = Color.TRANSPARENT
      val corner = dp(12).toFloat()
      setBoxCornerRadii(corner, corner, corner, corner)
      isErrorEnabled = true
      addView(address, matchHeight(dp(56)))
    }
    val connect = MaterialButton(this).apply {
      text = getString(R.string.server_connect)
      textSize = 14f
      setTextColor(Color.rgb(56, 30, 114))
      setTypeface(typeface, Typeface.BOLD)
      isAllCaps = false
      cornerRadius = dp(28)
      insetTop = 0
      insetBottom = 0
      backgroundTintList = android.content.res.ColorStateList.valueOf(Color.rgb(208, 188, 255))
    }
    val form = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(20), dp(20), dp(20), dp(20))
      addView(addressField, matchWrap())
      addView(connect, matchHeight(dp(56), top = dp(20)))
    }
    val formCard = MaterialCardView(this).apply {
      radius = dp(28).toFloat()
      cardElevation = 0f
      strokeWidth = dp(1)
      strokeColor = Color.rgb(73, 69, 79)
      setCardBackgroundColor(Color.rgb(33, 31, 38))
      addView(form, FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
      ))
    }
    val privacyText = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      addView(TextView(this@MainActivity).apply {
        text = getString(R.string.server_privacy_title)
        textSize = 14f
        setTextColor(Color.rgb(230, 224, 233))
        setTypeface(typeface, Typeface.BOLD)
      })
      addView(TextView(this@MainActivity).apply {
        text = getString(R.string.server_privacy)
        textSize = 13f
        setTextColor(Color.rgb(202, 196, 208))
        setLineSpacing(0f, 1.2f)
      }, matchHeight(LinearLayout.LayoutParams.WRAP_CONTENT, top = dp(4)))
    }
    val privacyCard = MaterialCardView(this).apply {
      radius = dp(16).toFloat()
      cardElevation = 0f
      setCardBackgroundColor(Color.rgb(29, 27, 32))
      addView(privacyText, FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
      ).apply { setMargins(dp(16), dp(14), dp(16), dp(14)) })
    }

    val connectToServer = {
      val normalized = normalizeServerUrl(address.text.toString())
      if (normalized == null) {
        addressField.error = getString(R.string.server_invalid)
        address.requestFocus()
      } else {
        addressField.error = null
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

    content.addView(logo, LinearLayout.LayoutParams(dp(72), dp(72)))
    content.addView(eyebrow, matchHeight(LinearLayout.LayoutParams.WRAP_CONTENT, top = dp(24)))
    content.addView(title, matchHeight(LinearLayout.LayoutParams.WRAP_CONTENT, top = dp(8)))
    content.addView(description, matchHeight(LinearLayout.LayoutParams.WRAP_CONTENT, top = dp(12)))
    content.addView(formCard, matchHeight(LinearLayout.LayoutParams.WRAP_CONTENT, top = dp(32)))
    content.addView(privacyCard, matchHeight(LinearLayout.LayoutParams.WRAP_CONTENT, top = dp(16)))

    setSafeContent(ScrollView(this).apply {
      setBackgroundColor(Color.rgb(20, 18, 24))
      isFillViewport = true
      addView(content, matchHeight(LinearLayout.LayoutParams.MATCH_PARENT))
    })
  }

  override fun onStart() {
    super.onStart()
    ContextCompat.registerReceiver(
      this,
      playbackEvents,
      IntentFilter(PlaybackService.ACTION_PLAYBACK_EVENT),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    dispatchPlaybackSnapshot()
  }

  private fun dispatchPlaybackSnapshot() {
    val payload = JSONObject(PlaybackService.snapshot.toJson()).put("type", "snapshot").toString()
    webView?.post {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('music-together-native-playback',{detail:$payload}))",
        null,
      )
    }
  }

  override fun onStop() {
    runCatching { unregisterReceiver(playbackEvents) }
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

  private fun Uri.isHttpOrHttps(): Boolean = scheme in setOf("http", "https") && !host.isNullOrBlank()

  private fun sameOrigin(first: Uri, second: Uri): Boolean =
    first.scheme.equals(second.scheme, ignoreCase = true) &&
      first.host.equals(second.host, ignoreCase = true) &&
      effectivePort(first) == effectivePort(second)

  private fun effectivePort(uri: Uri): Int = when {
    uri.port >= 0 -> uri.port
    uri.scheme.equals("https", ignoreCase = true) -> 443
    else -> 80
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

  private fun setSafeContent(content: View) {
    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.rgb(20, 18, 24))
      addView(content, FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ))
    }
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
      insets
    }
    setContentView(root)
    ViewCompat.requestApplyInsets(root)
  }

  private inner class PlaybackBridge(
    private val context: Context,
    private val approvedServerUrl: String,
  ) {
    @JavascriptInterface
    fun configureSession(config: String) {
      val json = runCatching { JSONObject(config) }.getOrNull() ?: return
      if (!json.has("roomId") || !json.has("userId") || !json.has("nickname")) return
      json.put("serverUrl", approvedServerUrl)
      val cookie = CookieManager.getInstance().getCookie(approvedServerUrl) ?: ""
      send(PlaybackService.ACTION_CONFIGURE) {
        putExtra(PlaybackService.EXTRA_CONFIG, json.toString())
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
    @JavascriptInterface fun getTrackId(): String = PlaybackService.snapshot.trackId
    @JavascriptInterface fun getPlaybackSnapshot(): String = PlaybackService.snapshot.toJson()
    @JavascriptInterface fun releaseSource(source: String) = send(PlaybackService.ACTION_RELEASE_SOURCE) {
      putExtra(PlaybackService.EXTRA_SOURCE, source)
    }
    @JavascriptInterface fun releaseSession() = send(PlaybackService.ACTION_RELEASE_SESSION)

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
