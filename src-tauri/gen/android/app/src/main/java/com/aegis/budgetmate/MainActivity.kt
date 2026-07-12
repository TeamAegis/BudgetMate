package com.aegis.budgetmate

import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // The BudgetMate web UI is always light (white background), independent of the device OS theme,
    // so force a light status bar (dark icons). The bare enableEdgeToEdge() default is
    // SystemBarStyle.auto, which follows the OS theme and paints WHITE icons in dark mode - invisible
    // on our white app background (issue I6). SystemBarStyle.light gives dark icons unconditionally,
    // is set once here, and survives configuration changes. No INTERNET permission is touched.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }
}
