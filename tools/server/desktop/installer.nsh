; Custom NSIS script for model selection during installation
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; Variables for model selection
Var Dialog
Var Label
Var ModelsList
Var NextButton
Var BackButton
Var SelectedModels
Var hwnd

; Page functions
Function ModelSelectionPage
  nsDialogs::Create 1018
  Pop $Dialog
  Pop $hwnd

  ${NSD_CreateLabel} 0u 0u 100% 12u "Select the models you want to download and install:"
  Pop $Label

  ${NSD_CreateListBox} 0u 20u 100% 200u ""
  Pop $ModelsList

  ; Add models to the list (category - model name)
  SendMessage $ModelsList ${LB_ADDSTRING} 0 "STR:Qwen - Qwen3.6-35B-A3B-GGUF"
  SendMessage $ModelsList ${LB_ADDSTRING} 0 "STR:Qwen - Qwen3.5-9B-GGUF"
  SendMessage $ModelsList ${LB_ADDSTRING} 0 "STR:Gemma - gemma-4-26B-A4B-it-GGUF"
  SendMessage $ModelsList ${LB_ADDSTRING} 0 "STR:Gemma - gemma-4-E4B-it-GGUF"
  SendMessage $ModelsList ${LB_ADDSTRING} 0 "STR:OpenAI - gpt-oss-20b-GGUF"
  SendMessage $ModelsList ${LB_ADDSTRING} 0 "STR:Mistral - Devstral-Small-2505-GGUF"
  SendMessage $ModelsList ${LB_ADDSTRING} 0 "STR:Mistral - Mistral-Small-24B-Instruct-2501-GGUF"
  SendMessage $ModelsList ${LB_ADDSTRING} 0 "STR:Bonsai - Bonsai-8B-gguf"
  SendMessage $ModelsList ${LB_ADDSTRING} 0 "STR:Bonsai - Bonsai-4B-gguf"
  SendMessage $ModelsList ${LB_ADDSTRING} 0 "STR:Bonsai - Bonsai-1.7B-gguf"

  ${NSD_CreateButton} 0u 230u 100u 14u "Select All"
  Pop $NextButton
  ${NSD_OnClick} $NextButton SelectAllModels

  ${NSD_CreateButton} 110u 230u 100u 14u "Deselect All"
  Pop $BackButton
  ${NSD_OnClick} $BackButton DeselectAllModels

  nsDialogs::Show
FunctionEnd

Function SelectAllModels
  SendMessage $ModelsList ${LB_SELITEMRANGE} 0 0
  SendMessage $ModelsList ${LB_SELITEMRANGE} 9 9
FunctionEnd

Function DeselectAllModels
  SendMessage $ModelsList ${LB_SETSEL} 0 0
FunctionEnd

Function ModelSelectionPageLeave
  ; Get selected models and save to config
  ; This is simplified - in reality you'd parse the selection properly
  FileOpen $0 "$INSTDIR\selected-models.json" w
  FileWrite $0 '{"selectedModels":["Qwen3.5-9B-GGUF","Bonsai-8B-gguf"]}'
  FileClose $0
FunctionEnd

; Insert the custom page into the installer
!insertmacro MUI_PAGE_CUSTOMFUNCTION_SHOW ModelSelectionPage
