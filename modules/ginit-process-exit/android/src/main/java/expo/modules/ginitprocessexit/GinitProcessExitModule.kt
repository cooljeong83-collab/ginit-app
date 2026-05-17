package expo.modules.ginitprocessexit

import android.os.Process
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GinitProcessExitModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GinitProcessExit")

    Function("hardExit") {
      val activity = appContext.currentActivity
      activity?.finishAffinity()
      Process.killProcess(Process.myPid())
      System.exit(0)
    }
  }
}
