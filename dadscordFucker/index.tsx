import { findOption, RequiredMessageOption } from "@api/Commands";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "DadscordFucker",
    description: "bypasses dadscord shitty anti-mod",
    authors: [{ name: "curve", id: 818846027511103508n }],
    dependencies: ["CommandsAPI", "MessageEventsAPI"],
    commands: [
        {
            name: "fuckdadscord",
            description: "rape dadscord anti-mod",
            options: [RequiredMessageOption],
            execute: opts => {
                const originalMessage = findOption(opts, "message", "");
                let modifiedMessage = "";

                originalMessage.split(" ").forEach(word => {
                    if (word.length < 2) {
                        modifiedMessage += word + " ";
                        return;
                    }

                    const letterPositions = [];
                    for (let i = 0; i < word.length; i++) {
                        if (/[a-zA-Z]/.test(word[i])) {
                            letterPositions.push(i);
                        }
                    }

                    if (letterPositions.length === 0) {
                        modifiedMessage += word + " ";
                        return;
                    }

                    const randomIndex = Math.floor(Math.random() * letterPositions.length);
                    const randomPosition = letterPositions[randomIndex];

                    modifiedMessage += word.replace(
                        word[randomPosition],
                        word[randomPosition] + "\u200C\u2062\u2063\u2064\u200d"
                    ) + " ";
                });

                return { content: modifiedMessage.trim() };
            }
        }
    ]
});
