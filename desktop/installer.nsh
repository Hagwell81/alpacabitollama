; Custom NSIS include for alpacabitollama installer
; Enhanced installer with custom pages and user data directory creation

!macro customInit
  ; Initialization logic can be added here if needed
!macroend

!macro customInstall
  ; Create data directory for user models and settings
  CreateDirectory "$APPDATA\alpacabitollama"
  CreateDirectory "$APPDATA\alpacabitollama\models"
  CreateDirectory "$APPDATA\alpacabitollama\backends"
  CreateDirectory "$APPDATA\alpacabitollama\logs"

  DetailPrint "Created user data directories"
!macroend

!macro customUnInstall
  ; Clean up user data directories (optional - commented out by default)
  ; Uncomment the following lines to remove user data on uninstall

  ; MessageBox MB_YESNO "Do you want to remove all user data including models and settings?" IDNO skip_cleanup
  ; RMDir /r "$APPDATA\alpacabitollama"
  ; skip_cleanup:

  DetailPrint "Uninstallation complete"
!macroend

!macro customInstallMode
  ; Set default installation directory based on architecture
  ${If} ${RunningX64}
    StrCpy $INSTDIR "$PROGRAMFILES64\Alpacabitollama"
  ${Else}
    StrCpy $INSTDIR "$PROGRAMFILES\Alpacabitollama"
  ${EndIf}
!macroend
