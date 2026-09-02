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
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.android.material.button.MaterialButton
import com.google.android.material.card.MaterialCardView
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI

class MainActivity : ComponentActivity() {
  private var webView: WebView? = null
  private var contentRoot: FrameLayout? = null
  private var playerFullscreen = false
  private var connectionAttempt = 0L
  private var activityStarted = false
  private var serverConnectButton: MaterialButton? = null

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
        if (playerFullscreen) {
          setPlayerFullscreen(false)
          webView?.evaluateJavascript(
            "window.dispatchEvent(new Event('music-together-native-fullscreen-exit'))",
            null,
          )
          return
        }
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
    val trustedServer = TrustedServer(serverUrl)
    webView = WebView(this).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.mediaPlaybackRequiresUserGesture = false
      settings.userAgentString = "${settings.userAgentString} MusicTogetherAndroid/1"
      webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
          val target = request?.url ?: return true
          if (!request.isForMainFrame) return false
          if (request.isRedirect && !target.isHttpOrHttps()) return true
          if (sameOrigin(target, Uri.parse(trustedServer.url))) return false
          runCatching { startActivity(Intent(Intent.ACTION_VIEW, target)) }
          return true
        }

        override fun onPageFinished(view: WebView?, url: String?) {
          super.onPageFinished(view, url)
          val finalUri = url?.let(Uri::parse)
          if (finalUri?.isHttpOrHttps() == true && sameOrigin(finalUri, Uri.parse(trustedServer.url))) {
            trustedServer.url = originUrl(finalUri)
            getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit().putString(SERVER_URL, trustedServer.url).apply()
          }
        }
      }
      webChromeClient = WebChromeClient()
      addJavascriptInterface(PlaybackBridge(this@MainActivity, trustedServer), "MusicTogetherAndroid")
      loadUrl(if (sameOrigin(Uri.parse(initialUrl), Uri.parse(serverUrl))) initialUrl else serverUrl)
    }
    setSafeContent(webView ?: return)
  }

  private fun showServerPicker() {
    connectionAttempt += 1
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
    serverConnectButton = connect
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
      val normalized = ServerRedirects.normalize(address.text.toString())
      if (normalized == null) {
        addressField.error = getString(R.string.server_invalid)
        address.requestFocus()
      } else {
        addressField.error = null
        connect.isEnabled = false
        val attempt = ++connectionAttempt
        Thread {
          val resolution = runCatching { resolveServerRedirects(normalized) }.getOrNull()
          runOnUiThread {
            if (attempt != connectionAttempt || isFinishing || (Build.VERSION.SDK_INT >= 17 && isDestroyed)) return@runOnUiThread
            connect.isEnabled = true
            if (!activityStarted) return@runOnUiThread
            when {
              resolution == null -> {
                addressField.error = getString(R.string.server_redirect_failed)
                address.requestFocus()
              }
              resolution.accepted -> openServer(ServerRedirects.origin(resolution.uri), resolution.uri.toString())
              else -> {
                addressField.error = getString(R.string.server_redirect_invalid)
                address.requestFocus()
              }
            }
          }
        }.start()
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
    activityStarted = true
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
    activityStarted = false
    connectionAttempt += 1
    serverConnectButton?.isEnabled = true
    runCatching { unregisterReceiver(playbackEvents) }
    super.onStop()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    outState.putString(STATE_URL, webView?.url)
    super.onSaveInstanceState(outState)
  }

  override fun onDestroy() {
    connectionAttempt += 1
    serverConnectButton = null
    setPlayerFullscreen(false)
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

  private fun resolveServerRedirects(initial: URI): RedirectResolution = ServerRedirects.resolve(initial) { current ->
    val connection = current.toURL().openConnection() as HttpURLConnection
    try {
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 10_000
      connection.readTimeout = 10_000
      connection.requestMethod = "GET"
      connection.setRequestProperty("User-Agent", "MusicTogetherAndroid/1")
      connection.setRequestProperty("Range", "bytes=0-0")
      connection.connect()
      RedirectResponse(connection.responseCode, connection.getHeaderField("Location"))
    } finally {
      connection.disconnect()
    }
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

  private fun originUrl(uri: Uri): String = buildString {
    append(uri.scheme?.lowercase())
    append("://")
    append(uri.host)
    val port = effectivePort(uri)
    val defaultPort = if (uri.scheme.equals("https", ignoreCase = true)) 443 else 80
    if (port != defaultPort) append(":$port")
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
    contentRoot = root
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      if (playerFullscreen) {
        view.setPadding(0, 0, 0, 0)
      } else {
        val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        view.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
      }
      insets
    }
    setContentView(root)
    ViewCompat.requestApplyInsets(root)
  }

  private fun setPlayerFullscreen(enabled: Boolean) {
    playerFullscreen = enabled
    WindowCompat.setDecorFitsSystemWindows(window, !enabled)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      if (enabled) {
        systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        hide(WindowInsetsCompat.Type.systemBars())
      } else {
        show(WindowInsetsCompat.Type.systemBars())
      }
    }
    if (enabled) contentRoot?.setPadding(0, 0, 0, 0)
    contentRoot?.let { ViewCompat.requestApplyInsets(it) }
  }

  private inner class PlaybackBridge(
    private val context: Context,
    private val trustedServer: TrustedServer,
  ) {
    @JavascriptInterface
    fun configureSession(config: String) {
      val json = runCatching { JSONObject(config) }.getOrNull() ?: return
      if (!json.has("roomId") || !json.has("userId") || !json.has("nickname")) return
      json.put("serverUrl", trustedServer.url)
      val cookie = CookieManager.getInstance().getCookie(trustedServer.url) ?: ""
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
    @JavascriptInterface fun setPlayerFullscreen(enabled: Boolean) {
      runOnUiThread { this@MainActivity.setPlayerFullscreen(enabled) }
    }
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

  private data class TrustedServer(var url: String)
}
