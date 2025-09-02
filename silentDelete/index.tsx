import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { getIntlMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, React, RestAPI } from "@webpack/common";
import { definePluginSettings } from "@api/Settings";
import { findByPropsLazy } from "@webpack";
import { Forms, MessageStore, UserStore } from "@webpack/common";
import { Channel, Message } from "discord-types/general";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");

const settings = definePluginSettings({
    message: {
        type: OptionType.STRING,
        description: "the message you want it to hide it with",
        default: `‫‫‫`,
    }
});


async function action(obj: any, type: string, isMessage?: boolean) {
    const editedshit = (settings.store.message);
    await RestAPI.del({ url: `/channels/${obj.channel_id}/messages/${obj.id}` }).catch(async (e) => { });
    await RestAPI.post({
        url: `/channels/${obj.channel_id}/messages`,
        body: {
            mobile_network_type: "unknown",
            content: editedshit,
            nonce: obj.id,
            tts: false,
            allowed_mentions: {
                parse: ["users", "roles", "everyone"]
            },
            flags: 0
        },
    }).catch(async (e) => { });
}

function makeContextCallback(
    name: string,
    action: (any) => void,
): NavContextMenuPatchCallback {
    return (children, props) => {
        if (props.label === getIntlMessage("CHANNEL_ACTIONS_MENU_LABEL"))
            return;

        const value = props[name];
        if (!value) return;
        const lastChild = children.at(-1);
        if (lastChild?.key === "developer-actions") {
            const p = lastChild.props;
            if (!Array.isArray(p.children)) p.children = [p.children];

            children = p.children;
        }

        children.push(
            <Menu.MenuItem
                id={`silent-${name}-delete`}
                label="silent delete"
                action={() => action(value)}
            />,
        );
    };
}

export default definePlugin({
    name: "silentDelete",
    description: "Custom message delete and edit plugin",
    authors: [{ name: "curve", id: 818846027511103508n }, { name: "dot", id: 1400606596521791773n }],
    enabledByDefault: true,
    contextMenus: {
        message: makeContextCallback("message", val =>
            action(val, "Message", true),
        ),
    },
    settings: settings
});
