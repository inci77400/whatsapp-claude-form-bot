#!/bin/bash
# Arka plan servisini durdurur ve kaldırır (bot tamamen kapanır).
ETIKET="com.whatsappbot.formbot"
launchctl bootout "gui/$(id -u)/$ETIKET" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$ETIKET.plist"
rm -rf "$HOME/Applications/WhatsApp Bot.app"
echo "⏹️  Servis durduruldu. Tekrar başlatmak için 'Servis Kur.command'."
read -p "Kapatmak için Enter"
