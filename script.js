async function updateAudioClip(fhandle) {
    // Note this looks for the pattern `AudioClip.play("id")` or `AudioClip.play("id")`. Will not match `AudioClip.play("local::resourceId.contentId")`
    // Note: Uses `(?:[\s\r\n]|\\r|\\n)*` is used so that it can match newlines in JSON and in hx files. Can remove both to not have this issue
    const audio_clip_re = /(AudioClip\.play\((?:[\s\r\n]|\\r|\\n)*)(\\?"[^:]*?\\?")((?:[\s\r\n]|\\r|\\n)*(?:,(?:[\s\r\n]|\\r|\\n)*\{.*?\}(?:[\s\r\n]|\\r|\\n)*)?\)(?:[\s\r\n]|\\r|\\n)*;)/g;
    // get contents
    const read_handle = await fhandle.getFile();
    var contents = await read_handle.text();
    const matches = ((contents || '').match(audio_clip_re) || []);
    if (matches.length > 0) {
        console.log(`Found ${matches.length} incorrect calls of the form AudioClip.play("id", ...) in ${read_handle.name}`);
        // for (const match of matches) {
        //     console.log(`--- MATCH ::: ${match}`);
        // }
        contents = contents.replace(audio_clip_re, "$1self.getResource().getContent($2)$3");
        const write_handle = await fhandle.createWritable();
        await write_handle.write(contents);
        await write_handle.close();
    }
    return matches.length;
}

async function applyForFolder(dirHandle, func) {
    total_matches = 0;
    for await (const entry of dirHandle.values()) {
        if (entry.kind == 'file') {
            total_matches += await func(entry);
        }
        else if (entry.kind == 'directory') {
            // recursion should be optional and have a max depth
            total_matches += await applyForFolder(entry, func);
        }
    }
    return total_matches;
}

window.addEventListener("load", (e) => {
    const result_box = document.getElementById("result");
    const start_button = document.getElementById("start_process");
    const can_modify_fs = ("showDirectoryPicker"  in window);
    if (can_modify_fs) {
        start_button.addEventListener("click", async (event) => {
            window.showDirectoryPicker({ id: "ft_folder", mode: "readwrite" }).then(async (dirHandle) => {
                for await (const entry of dirHandle.values()) {
                    if (entry.name.endswith(".fraytools")) return dirHandle;
                }
                throw "Couldn't find .fraytools file";
            }).then(async (dirHandle) =>{
                var matches = await applyForFolder(dirHandle, updateAudioClip);
                return matches;
            }).then((num_matches) => {
                result_box.innerHTML = `Successfully applied to folder. Found <span>${num_matches}</span> matches.`;
                result_box.classList = "desc success_resp";
                console.log("Successfully applied to folder");
            }).catch( (err) => {
                if (!(err instanceof AbortError)) {
                    result_box.textContent = "Couldn't open provided folder, or folder does not have a .fraytools file. Please try again.";
                    result_box.classList = "desc error_resp";
                    console.error(`Failed to apply to folder. Reason: ${err}`);
                }
            });
        });
    } else {
        start_button.disabled = true;
        result_box.textContent = "Can't access the filesystem directly with this browser 😢. Try using something chromium ...";
        result_box.classList = "desc error_resp";
        console.error(`showDirectoryPicker is not supported in this browser`);
    }
});