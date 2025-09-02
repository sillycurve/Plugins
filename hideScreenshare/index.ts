import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, Toasts } from "@webpack/common";

const settings = definePluginSettings({
    keybind: {
        type: OptionType.STRING,
        description: "Keybind to toggle hide from capture (format: ctrl+shift+h, alt+p, etc.)",
        default: "alt+p",
        onChange: (value: string) => {
            unregisterKeybind();
            registerKeybind(value);
        }
    },
    showToast: {
        type: OptionType.BOOLEAN,
        description: "Show toast notification when toggled",
        default: true
    }
});

let isHiddenFromCapture = false;
let registeredKeybind: string | null = null;

function parseKeybind(keybind: string): { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string } {
    const parts = keybind.toLowerCase().split('+');
    const result = {
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        key: ''
    };

    for (const part of parts) {
        switch (part.trim()) {
            case 'ctrl':
            case 'control':
                result.ctrlKey = true;
                break;
            case 'alt':
                result.altKey = true;
                break;
            case 'shift':
                result.shiftKey = true;
                break;
            default:
                result.key = part.trim();
                break;
        }
    }

    return result;
}

function showToggleNotification(isHidden: boolean) {
    if (!settings.store.showToast) return;

    const message = isHidden ?
        "🛡️ Hidden from screen capture" :
        "👁️ Visible in screen capture";

    Toasts.show({
        message,
        id: "hide-from-capture-toggle",
        type: isHidden ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
        options: {
            position: Toasts.Position.BOTTOM,
            duration: 3000
        }
    });
}

function toggleHideFromCapture() {
    try {
        isHiddenFromCapture = !isHiddenFromCapture;

        FluxDispatcher.dispatch({
            type: "MEDIA_ENGINE_SET_DISPLAY_MEDIA_WINDOW_ID",
            windowId: isHiddenFromCapture ? "0" : null
        });

        if (window.DiscordNative?.window) {
            window.DiscordNative.window.setContentProtection(isHiddenFromCapture);
        }

        showToggleNotification(isHiddenFromCapture);
    } catch (error) {
        console.error("Failed to toggle hide from capture:", error);

        if (settings.store.showToast) {
            Toasts.show({
                message: "❌ Failed to toggle screen capture hiding",
                id: "hide-from-capture-error",
                type: Toasts.Type.FAILURE,
                options: {
                    position: Toasts.Position.BOTTOM,
                    duration: 4000
                }
            });
        }
    }
}

function handleKeydown(event: KeyboardEvent) {
    const keybind = parseKeybind(settings.store.keybind);

    if (
        event.ctrlKey === keybind.ctrlKey &&
        event.altKey === keybind.altKey &&
        event.shiftKey === keybind.shiftKey &&
        event.key.toLowerCase() === keybind.key
    ) {
        event.preventDefault();
        event.stopPropagation();
        toggleHideFromCapture();
    }
}

function registerKeybind(keybind: string) {
    if (registeredKeybind) {
        unregisterKeybind();
    }

    document.addEventListener('keydown', handleKeydown, true);
    registeredKeybind = keybind;
}

function unregisterKeybind() {
    if (registeredKeybind) {
        document.removeEventListener('keydown', handleKeydown, true);
        registeredKeybind = null;
    }
}

export default definePlugin({
    name: "hideScreenshare",
    description: "Toggle Discord's 'Hide from screen capture' feature with a customizable keybind without enabling streamer mode",
    authors: [{ name: "curve", id: 818846027511103508n }, { name: "dot", id: 1400606596521791773n }],
    settings,

    start() {
        registerKeybind(settings.store.keybind);
    },

    stop() {
        unregisterKeybind();
        if (isHiddenFromCapture) {
            isHiddenFromCapture = false;
            try {
                FluxDispatcher.dispatch({
                    type: "MEDIA_ENGINE_SET_DISPLAY_MEDIA_WINDOW_ID",
                    windowId: null
                });

                if (window.DiscordNative?.window) {
                    window.DiscordNative.window.setContentProtection(false);
                }
            } catch (error) {
                console.error("Failed to reset hide from capture state:", error);
            }
        }
    }
});