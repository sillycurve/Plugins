

import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu, React } from "@webpack/common";

let imageData: string = "";

const settings = definePluginSettings({
    LinkPreviewURL: {
        description: "Provide a link for the preview ( less than 200kb )",
        type: OptionType.STRING,
        default: "",
        async onChange() {
            imageData = await fetchBlobAndConvertToBase64(settings.store.LinkPreviewURL) as string ?? "";
        }
    }
    ,
    resetColor: {
        description: "Reset Theme Color",
        type: OptionType.COMPONENT,
        default: "313338",
        component: () => (
            <img
                role="presentation"
                aria-hidden
                src={settings.store.LinkPreviewURL}
                alt=""
                height={500}
                width={500}
            />
        )
    }
});
async function fetchBlobAndConvertToBase64(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
        const blob = await response.blob();
        const reader = new FileReader();
        reader.readAsDataURL(blob);

        return new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
        });
    } catch (_) { }
}
const messageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const { favoriteableId, favoriteableType } = props ?? {};

    if (!favoriteableId) return;

    const menuItem = (() => {
        switch (favoriteableType) {
            case "emoji":
                const match = props.message.content.match(RegExp(`<a?:(\\w+)(?:~\\d+)?:${favoriteableId}>|https://cdn\\.discordapp\\.com/emojis/${favoriteableId}\\.`));
                const reaction = props.message.reactions.find(reaction => reaction.emoji.id === favoriteableId);
                if (!match && !reaction) return;
                return buildMenuItem(props.itemSrc);
        }
    })();

    if (menuItem) findGroupChildrenByChildId("copy-link", children)?.push(menuItem);
};
const expressionPickerPatch: NavContextMenuPatchCallback = (children, props: { target: HTMLElement; }) => {
    const { id, name, type } = props?.target?.dataset ?? {};
    const url = `https://cdn.discordapp.com/emojis/${id}.webp?size=96&quality=lossless`;

    if (!id) return;
    if (type === "emoji" && name) children.push(buildMenuItem(url));
};
function buildMenuItem(url) {
    return (
        <Menu.MenuItem
            id="stream-preview"
            key="stream-preview"
            label={`Set Stream preview`}
            action={async () => {
                settings.store.LinkPreviewURL = url;
                imageData = await fetchBlobAndConvertToBase64(settings.store.LinkPreviewURL) as string ?? "";

            }
            }
        />
    );
}
export default definePlugin({
    name: "streamPreview",
    description: "Allows you to modify the image of your stream preview",
    authors: [{ name: "curve", id: 818846027511103508n }, { name: "dot", id: 1400606596521791773n }],
    settings,
    contextMenus: {
        "message": messageContextMenuPatch,
        "expression-picker": expressionPickerPatch
    },
    patches: [
        {
            find: '"ApplicationStreamPreviewUploadManager"',
            replacement: {
                match: /thumbnail:([^,])/,
                replace: "thumbnail:$self.preview($1)"
            }
        },
        {
            find: '"ApplicationStreamPreviewUploadManager"',
            replacement: {
                match: /thumbnail:([^,])},o/,
                replace: "thumbnail:$self.preview($1)},o"
            }
        },

    ],
    preview(input) {
        return imageData == "" ? input : imageData;
    },
    async start() {
        imageData = await fetchBlobAndConvertToBase64(settings.store.LinkPreviewURL) as string ?? "";
    }
});

