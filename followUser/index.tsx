import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { findByPropsLazy, findStoreLazy, findByCodeLazy, findLazy } from "@webpack";
import { Menu, RestAPI, React, ChannelStore, GuildStore, UserStore, ContextMenuApi, PermissionStore, FluxDispatcher, Toasts, Forms, GuildChannelStore } from "@webpack/common";
import { definePluginSettings } from "@api/Settings";
import { openUserProfile } from "@utils/discord";
import { debounce } from "@shared/debounce";
import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";


const CONNECT = 1n << 20n;
const STREAM = 1n << 9n;

const settings = definePluginSettings({
    Delay: {
        type: OptionType.NUMBER,
        description: "Adds a delay between joining channels [ ms ]",
        default: 0,
    },
    follow: {
        type: OptionType.BOOLEAN,
        description: "toggles follow",
        default: true,
    },
    autoCamera: {
        type: OptionType.BOOLEAN,
        description: "Automatically turns on camera",
        default: false,
    },
    autoNavigate: {
        type: OptionType.BOOLEAN,
        description: "Automatically navigates to the channel",
        default: false,
    },
    multi: {
        type: OptionType.BOOLEAN,
        description: "toggles multi",
        default: true,
    },
    users: {
        type: OptionType.STRING,
        description: "User list seperated by /",
        default: "",
    },
    spacesLeft: {
        type: OptionType.NUMBER,
        description: "Number of spaces needed before joining a voice channel",
        default: 1,
    },

});
const currentvc = () => {
    const { channelId } = VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id) ?? {};
    return channelId ? `<#${channelId}>` : "";
};
const ChannelActions = findByPropsLazy("selectChannel", "selectVoiceChannel");
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const Button = findByCodeLazy("Button.Sizes.NONE,disabled:");

export default definePlugin({
    name: "followUser",
    description: "Follows users through voice channels",
    authors: [{ name: "curve", id: 818846027511103508n }],
    contextMenus: { "user-context": makeContextMenuPatch(), },
    FollowButton: ErrorBoundary.wrap(FollowButton, { noop: true }),
    settings,
    patches: [
        {
            find: ".Messages.ACCOUNT_SPEAKING_WHILE_MUTED",
            replacement: {
                match: /this\.renderNameZone\(\).+?children:\[/,
                replace: "$&$self.FollowButton(),",
            },
        },
    ],

    commands: [
        {
            name: "vc",
            description: "Sends your current vc",
            options: [],
            execute: () => ({
                content: currentvc()
            }),
        },
        {
            name: "follow user",
            description: "Follows a user between voice chats",
            options: [
                {
                    name: "user-id",
                    description: "Enter user ID",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
            ],
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (opts, ctx) => {
                settings.store.users += `/${opts[0].value}`;
            },
        },
    ],
    subscribeToAllGuilds() {
        const guilds = Object.values(GuildStore.getGuilds()).map(guild => guild.id);
        const subscriptions = guilds.reduce((acc, id) => ({ ...acc, [id]: { typing: true } }), {});
        FluxDispatcher.dispatch({ type: "GUILD_SUBSCRIPTIONS_FLUSH", subscriptions });
    },
    start() {
        GuildStore.getGuilds();
        const cb = async (e: any) => {
            if (!settings.store.follow) return;
            const state = e.voiceStates[0];
            if (state.userId == UserStore.getCurrentUser().id || !state.userId) return;
            if (state?.channelId == state?.oldChannelId) return;
            if (settings.store.users.split('/').filter(item => item !== '').length === 0) return;
            const channels: any[] = [];
            for (const id of settings.store.users.split('/').filter(item => item !== '')) {
                const { channelId } = VoiceStateStore.getVoiceStateForUser(id) ?? {};
                if (channelId !== null) channels.push({ channel: channelId, user: id });
            }
            if (settings.store.users.split('/').filter(item => item !== '').includes(state.userId) || channels.find(c => c?.channel === state.oldChannelId)) {
                const user = UserStore.getUser(state.userId);
                if (settings.store.users.split('/').filter(item => item !== '').includes(state.userId)) {
                    if (!state.channelId) {
                        const tempChannel = ChannelStore.getChannel(state?.oldChannelId);
                        let channelName;
                        if (tempChannel.isDM()) channelName = "dms";
                        else if (tempChannel.isGroupDM()) channelName = "a group";
                        else channelName = tempChannel.name;

                        Toasts.show({
                            message: `${user.username} disconnected from ${channelName} `,
                            id: "Vc-disconnected",
                            type: Toasts.Type.MESSAGE,
                            options: {
                                position: Toasts.Position.BOTTOM,
                            }
                        });

                        return;
                    };
                    const channel = ChannelStore.getChannel(state?.channelId);
                    const channelVoiceStates = VoiceStateStore.getVoiceStatesForChannel(state?.channelId) ?? {};
                    if (Object.keys(channelVoiceStates).length == channel?.userLimit) {
                        if (Object.keys(channelVoiceStates).includes(UserStore.getCurrentUser().id)) return;
                        Toasts.show({
                            message: `${user.username} Joined a full voice channel.`,
                            id: "Joined-a-full-voice-channel",
                            type: Toasts.Type.FAILURE,
                            options: {
                                position: Toasts.Position.BOTTOM,
                            }
                        });
                    }
                    else { JoinVc(state.channelId); }
                    return;
                }

                if (channels.find(c => c.channel === state?.oldChannelId)) {
                    if (!state.oldChannelId) return;
                    const channel = ChannelStore.getChannel(state?.oldChannelId);
                    const channelVoiceStates = VoiceStateStore.getVoiceStatesForChannel(state?.oldChannelId) ?? {};
                    if (Object.keys(channelVoiceStates).includes(UserStore.getCurrentUser().id)) return;
                    if (Object.keys(channelVoiceStates).length !== channel?.userLimit - settings.store.spacesLeft || channel?.userLimit === 0) return;
                    const user = UserStore.getUser(channels.find(c => c.channel === state?.oldChannelId).user);
                    Toasts.show({
                        message: `Vc sniped ${user.username}`,
                        id: "Vc-sniped",
                        type: Toasts.Type.SUCCESS,
                        options: {
                            position: Toasts.Position.BOTTOM,
                        }
                    });
                    JoinVc(state.oldChannelId);
                }
            }
        };

        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", cb);
    },
});
function FollowButton() {
    const [enabled, setEnabled] = React.useState(settings.store.follow);
    function setEnabledValue(value: boolean) {
        setEnabled(value);
        settings.store.follow = value;
    }

    return (
        <>
            <Button
                onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <ContextMenu />)}
                onClick={() => setEnabledValue(!enabled)}
                role="switch"
                tooltipText={"xaydes Follow"}
            />
        </>
    );
}
function MenuItem(id: string) {
    if (!settings.store.follow || UserStore.getCurrentUser().id === id) return;
    const [isChecked, setIsChecked] = React.useState(settings.store.users.split('/').filter(item => item !== '').includes(id));
    return (
        <Menu.MenuCheckboxItem
            id="follow"
            label="Follow"
            checked={isChecked}
            action={async () => {
                const updatedList = [...settings.store.users.split('/').filter(item => item !== '')];
                const index = updatedList.indexOf(id);
                if (index === -1) {
                    updatedList.push(id);
                    await loadGuilds(id);
                    const { channelId } = VoiceStateStore.getVoiceStateForUser(id) ?? {};
                    JoinVc(channelId);
                } else {
                    updatedList.splice(index, 1);
                    id = "";
                };


                console.log(index);

                console.log(updatedList);

                setIsChecked(!isChecked);
                settings.store.users = settings.store.multi ? updatedList.join("/") : id;
            }}
        />
    );

}
function makeContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props) => {
        if (!props) return;
        const follow = MenuItem(props.user.id);
        if (!follow) return;
        children.splice(-1, 0, <Menu.MenuGroup>{follow}</Menu.MenuGroup>);
    };
}
function ContextMenu() {
    const [isChecked, setIsChecked] = React.useState(settings.store.users.split('/').filter(item => item !== ''));
    const [mode, setMode] = React.useState(settings.store.multi);
    const [naviagte, setNaviagte] = React.useState(settings.store.autoNavigate);
    const [camera, setCamera] = React.useState(settings.store.autoCamera);
    const [, setReset] = React.useState(false);
    return (
        <Menu.Menu
            navId="Voice-state-modifier"
            onClose={() => { }}
            aria-label="Voice state modifier"
        >
            <Menu.MenuItem
                id="xaydes follow"
                label="xaydes follow"
                action={() => openUserProfile("12142892472137155173")}
            />

            <Menu.MenuSeparator />

            <Menu.MenuGroup
                label="FOLLOW MODE"
            >
                <Menu.MenuRadioItem
                    key={"multi"}
                    group="mode"
                    id={"multi"}
                    label={"Multi"}
                    checked={mode === true}
                    action={() => {
                        setMode(true);
                        settings.store.multi = true;
                    }}
                />
                <Menu.MenuRadioItem
                    key={"single"}
                    group="mode"
                    id={"single"}
                    label={"Single"}
                    checked={mode === false}
                    action={() => {
                        setMode(false);
                        settings.store.multi = false;
                    }}
                />

            </Menu.MenuGroup>
            <Menu.MenuGroup
                label="SETTINGS"
            >

                <Menu.MenuCheckboxItem
                    key="autoNaviagte"
                    id="autoNaviagte"
                    label="Auto Naviagte"
                    action={() => {
                        setNaviagte(!naviagte);
                        settings.store.autoNavigate = !naviagte;
                    }}
                    checked={naviagte}
                />
                <Menu.MenuCheckboxItem
                    key="autoCamera"
                    id="autoCamera"
                    label="Auto Camera"
                    action={() => {
                        setCamera(!camera);
                        settings.store.autoCamera = !camera;

                    }}
                    checked={camera}
                />

                <Menu.MenuSeparator />


                <Menu.MenuControlItem
                    id="Delay"
                    label="Follow delay"
                    control={(props, ref) => (
                        <Menu.MenuSliderControl
                            ref={ref}
                            {...props}
                            minValue={0}
                            maxValue={10}
                            value={settings.store.Delay}
                            onChange={debounce((value: number) => {
                                settings.store.Delay = Number(value.toFixed(2));
                            }, 50)} renderValue={(value: number) => `${value.toFixed(2)} s`}
                        />
                    )}
                />
                <Menu.MenuControlItem
                    id="spaces-left"
                    label="spaces-left"
                    control={(props, ref) => (
                        <Menu.MenuSliderControl
                            ref={ref}
                            {...props}
                            minValue={1}
                            maxValue={10}
                            value={settings.store.spacesLeft}
                            onChange={debounce((value: number) => {
                                settings.store.spacesLeft = Number(value.toFixed(0));
                            }, 50)} renderValue={(value: number) => `${value.toFixed(0)}`}
                        />
                    )}
                />
                <Menu.MenuSeparator />


                <Menu.MenuItem
                    id="clear list "
                    label="Reset list"
                    disabled={isChecked.length == 0}
                    action={() => {
                        setReset(true);
                        settings.store.users = "";

                    }}
                />

            </Menu.MenuGroup>
            <Menu.MenuGroup
                label="FOLLOW LIST"
            >
                <Menu.MenuSeparator />

                {settings.store.users.split('/').filter(item => item !== '').length === 0 ?
                    <Menu.MenuItem
                        id="Empty List"
                        label="Empty"
                        disabled={true}
                    /> :
                    settings.store.users.split('/').filter(item => item !== '').map((id) => (
                        <>
                            <Menu.MenuItem
                                id={String(id)}
                                label={UserStore.getUser(String(id))?.username ?? id}
                                action={() => openUserProfile(String(id))}
                                children={

                                    <Menu.MenuItem
                                        key={String(id)}
                                        id={String(id) + "p"}
                                        label="Remove"
                                        action={() => {
                                            const updatedList = [...settings.store.users.split('/').filter(item => item !== '')];
                                            const index = updatedList.indexOf(id);
                                            if (index === -1) {
                                                updatedList.push(id);
                                            } else {
                                                updatedList.splice(index, 1);
                                            }
                                            setIsChecked(updatedList);
                                            settings.store.users = updatedList.join("/");
                                        }}
                                    />
                                }
                            />
                        </>
                    ))}
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}
function JoinVc(channelID) {
    setTimeout(function () {
        const channel = ChannelStore.getChannel(channelID);
        if (!channel) return;
        if (!channel.isDM() && !channel.isGroupDM() && !PermissionStore.can(CONNECT, channel)) {
            Toasts.show({
                message: `Insufficient permissions to join ${channel.name}`,
                id: "Vc-permissions",
                type: Toasts.Type.FAILURE,
                options: {
                    position: Toasts.Position.BOTTOM,
                }
            });
            return;
        }
        console.log(channelID);
        ChannelActions.selectVoiceChannel(channelID);
        if (settings.store.autoNavigate) autoNavigate(channel.guild_id, channel.id);
        if (settings.store.autoCamera && PermissionStore.can(STREAM, channel)) autoCamera();
    }, settings.store.Delay * 1000);
}
async function loadGuilds(id) {
    const { body } = await RestAPI.get({
        url: `/users/${id}/profile`,
        query: {
            with_mutual_guilds: true,
        },
    }); const ids: string[] = [];
    body.mutual_guilds.forEach((item) => {
        ids.push(item.id);
        const guild = GuildStore.getGuild(item.id);
    });

}
function autoNavigate(guild: string, channel: string) {
    const checkExist = setInterval(() => {
        const navigate = document.querySelector(`a[href="/channels/${guild}/${channel}"]`) as HTMLButtonElement;
        if (navigate) {
            navigate.click();
            clearInterval(checkExist);
        }
    }, 50);
}
function autoCamera() {
    const checkExist = setInterval(() => {
        const cameraOFF = document.querySelector('[aria-label="Turn off Camera" i]') as HTMLButtonElement;
        if (cameraOFF) clearInterval(checkExist);

        const camera = document.querySelector('[aria-label="Turn on Camera" i]') as HTMLButtonElement;

        if (camera) {
            clearInterval(checkExist);
            camera.click();
        }
    }, 50);
}






