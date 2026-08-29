package app.musictogether.android

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
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
  private lateinit var webView: WebView

  private val playbackEvents = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val payload = intent?.getStringExtra(PlaybackService.EXTRA_EVENT) ?: return
      webView.post {
        webView.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('music-together-native-playback',{detail:$payload}))",
          null,
        )
      }
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestNotificationPermission()

    webView = WebView(this).apply {
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.mediaPlaybackRequiresUserGesture = false
      settings.userAgentString = "${settings.userAgentString} MusicTogetherAndroid/1"
      webViewClient = WebViewClient()
      webChromeClient = WebChromeClient()
      addJavascriptInterface(PlaybackBridge(this@MainActivity), "MusicTogetherAndroid")
      loadUrl(savedInstanceState?.getString(STATE_URL) ?: BuildConfig.APP_URL)
    }
    setContentView(webView)

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (webView.canGoBack()) webView.goBack() else finish()
      }
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
  }

  override fun onStop() {
    unregisterReceiver(playbackEvents)
    super.onStop()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    outState.putString(STATE_URL, webView.url)
    super.onSaveInstanceState(outState)
  }

  override fun onDestroy() {
    webView.removeJavascriptInterface("MusicTogetherAndroid")
    webView.destroy()
    super.onDestroy()
  }

  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }
  }

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
  }
}
