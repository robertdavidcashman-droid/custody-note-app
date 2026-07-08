!macro customInit
  CreateDirectory "$APPDATA\custody-note"
  FileOpen $9 "$APPDATA\custody-note\cn-nsis-install.log" a
  FileSeek $9 0 END
  FileWrite $9 "$\r$\n=== NSIS customInit START ===$\r$\n"
  FileWrite $9 "INSTDIR=$INSTDIR$\r$\n"
  FileWrite $9 "CMDLINE=$CMDLINE$\r$\n"

  ; Kill only the named process — no /T (tree-kill would kill this installer
  ; because Windows sees it as a child of "Custody Note.exe").
  FileWrite $9 "Killing Custody Note processes...$\r$\n"
  nsExec::ExecToLog 'taskkill /F /IM "Custody Note.exe"'
  Pop $0
  FileWrite $9 "taskkill main exit=$0$\r$\n"
  nsExec::ExecToLog 'taskkill /F /FI "WINDOWTITLE eq Custody Note*"'
  Pop $0
  FileWrite $9 "taskkill window exit=$0$\r$\n"

  FileWrite $9 "Wait 3s for process termination...$\r$\n"
  Sleep 3000

  nsExec::ExecToLog 'taskkill /F /IM "Custody Note.exe"'
  Pop $0
  FileWrite $9 "taskkill retry exit=$0$\r$\n"
  Sleep 3000

  FileWrite $9 "customInit complete$\r$\n"
  FileClose $9
!macroend

; Override the built-in un.atomicRMDir file removal. The default implementation
; tries to rename $INSTDIR atomically and ABORTs if any file handle is open
; (producing "Failed to uninstall old application files" error 2). External
; processes like IDE file watchers (Cursor) or antivirus commonly hold handles
; on app.asar. We use Delete /REBOOTOK + RMDir /r which skips locked files
; instead of aborting, then the install step overwrites with new versions.
!macro customRemoveFiles
  SetOutPath $TEMP

  ; Try to remove locked files gracefully — /REBOOTOK schedules for reboot
  ; if a handle prevents immediate deletion.
  Delete /REBOOTOK "$INSTDIR\resources\app.asar"
  Delete /REBOOTOK "$INSTDIR\resources\app.asar.bak"
  Delete /REBOOTOK "$INSTDIR\Custody Note.exe"
  Delete /REBOOTOK "$INSTDIR\Custody Note.exe.bak"

  ; Remove everything else that isn't locked.
  RMDir /r "$INSTDIR"
!macroend

!macro customUnInit
  nsExec::ExecToLog 'taskkill /F /IM "Custody Note.exe"'
  Pop $0
  Sleep 2000
!macroend
