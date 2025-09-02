import definePlugin, { OptionType } from "@utils/types";
import { Toasts, RestAPI, FluxDispatcher, UserStore, ChannelStore, GuildChannelStore, GuildMemberStore, Menu, React, GuildStore, useStateFromStores } from "@webpack/common";
import { definePluginSettings } from "@api/Settings";
import { findStoreLazy, findByPropsLazy } from "@webpack";
import { Message, User } from "discord-types/general";
import ErrorBoundary from "@components/ErrorBoundary";
import { PassiveUpdateState, VoiceState } from "@webpack/types";
import { Tooltip } from "@webpack/common";
import { channel } from "diagnostics_channel";

const Vclol = findStoreLazy("VoiceStateStore");
const retardcounter = new Map();
const retardtoucher = new Map();
let lastExecution = Promise.resolve();
const processedUsers = new Set();
const vc = findByPropsLazy("getVoiceChannelId");
const timers = new Map();

const settings = definePluginSettings({
    isEnabled: {
        description: "Enable the banning of reloading retards",
        type: OptionType.BOOLEAN,
        default: true
    }
});

let clientOldChannelId;

interface VoiceState {
    guildId?: string;
    channelId?: string;
    oldChannelId?: string;
    user: User;
    userId: string;
}

async function retardfunction(oldChannelId, userId) {
    if (processedUsers.has(userId)) return;
    const currentExecution = lastExecution.then(async () => {
        if (processedUsers.has(userId)) return;
        if (!Vencord.Plugins.plugins.vcOwnerDetector.settings.store.amivcowner) return;
        if (processedUsers.has(userId)) return;
        retardcounter.set(userId, -50);
        Toasts.show({
            message: `banning retard ${userId} made by atticus <3`,
            id: "auto-ban",
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });

        await RestAPI.post({
            url: `/channels/${oldChannelId}/messages`,
            body: {
                content: `!voice-unban ${userId}`,
                nonce: Math.floor(Math.random() * 10000000000000)
            }
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        await RestAPI.post({
            url: `/channels/${oldChannelId}/messages`,
            body: {
                content: `!voice-ban ${userId}`,
                nonce: Math.floor(Math.random() * 10000000000000)
            }
        });

        await new Promise(resolve => setTimeout(resolve, 2500));
        retardcounter.set(userId, 1);
        processedUsers.add(userId);
    });
    if (processedUsers.has(userId)) return;
    lastExecution = currentExecution.then(() => new Promise(resolve => setTimeout(resolve, 2000)));
    await currentExecution;
}

export default definePlugin({
    name: "retardToucher",
    description: "Tools simply take care of retards who leave a server and rejoin to reset permissions",
    authors: [{ name: "curve", id: 818846027511103508n }, { name: "dot", id: 1400606596521791773n }],
    settings,
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const clientUserId = UserStore.getCurrentUser().id;
            voiceStates.forEach(state => {
                const { userId, channelId } = state;
                const user = UserStore.getUser(userId) as User & { globalName: string; };
                let { oldChannelId } = state;
                if (!Vencord.Plugins.plugins.vcOwnerDetector.settings.store.amivcowner) return;
                if (userId === clientUserId && channelId !== clientOldChannelId) {
                    oldChannelId = clientOldChannelId;
                    clientOldChannelId = channelId;
                }
                if (oldChannelId !== vc.getVoiceChannelId()) return;
                if (oldChannelId === channelId) return;
                if (vc.getVoiceChannelId() === null) return;
                if ((oldChannelId && !channelId) || (oldChannelId && channelId)) {
                    if (!retardcounter.has(userId)) retardcounter.set(userId, 0);
                    retardcounter.set(userId, retardcounter.get(userId) + 1);
                    console.log(vc.getVoiceChannelId(), oldChannelId, retardcounter.get(userId), userId);
                    if (!timers.has(userId)) {
                        const interval = setInterval(() => {
                            const current = retardcounter.get(userId);
                            if (current <= 1) {
                                retardcounter.set(userId, 0);
                                clearInterval(interval);
                                timers.delete(userId);
                            } else {
                                retardcounter.set(userId, current - 1);
                            }
                        }, 60000);
                        timers.set(userId, interval);
                    }

                    if (retardcounter.get(userId) >= 3) {
                        retardfunction(oldChannelId, userId);
                    }
                }
            });
        }
    }
});