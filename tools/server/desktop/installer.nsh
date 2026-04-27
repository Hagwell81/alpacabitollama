; Custom NSIS include for alpacabitollama installer
; Installs the Visual C++ 2015-2022 Redistributable (x64) silently so that
; llama-server.exe and its companion DLLs can run on machines that do not
; already have the VC++ runtime installed.

!macro customInstall
  ; vc_redist.x64.exe is placed in $INSTDIR by the electron-builder extraFiles rule.
  ; Run it silently, then remove it so it does not clutter the install directory.
  ExecWait '"$INSTDIR\vc_redist.x64.exe" /install /quiet /norestart'
  Delete "$INSTDIR\vc_redist.x64.exe"
!macroend
