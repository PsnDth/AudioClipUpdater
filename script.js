// Note: The regex below have multiple versions to handle use within escaped json. Some examples:
//        - `(?:[\s\r\n]|\\r|\\n)*` matches spaces/newlines
//        - `\\?"` matches quotation marks

// Note this looks for the pattern `AudioClip.play("id")`. Will not match `AudioClip.play("local::resourceId.contentId")` or `AudioClip.play(Random.choice(...), ...)`
const FIXABLE_AUDIO_CLIP_MATCHER = /(AudioClip\.play\((?:[\s\r\n]|\\r|\\n)*)(\\?"[^:]*?\\?")((?:[\s\r\n]|\\r|\\n)*(?:,(?:[\s\r\n]|\\r|\\n)*\{.*?\}(?:[\s\r\n]|\\r|\\n)*)?\)(?:[\s\r\n]|\\r|\\n)*;)/g;

const HAS_AUDIO_CLIP_MATCHER = /AudioClip\.play/g;
const HAS_AUDIO_CLIP_GLOBAL_SFX = /AudioClip\.play\((?:[\s\r\n]|\\r|\\n)*(?:GlobalSfx.\w+|\\?"global::sfx.\w+\\?")(?:,(?:[\s\r\n]|\\r|\\n)*\{.*?\}(?:[\s\r\n]|\\r|\\n)*)?\)(?:[\s\r\n]|\\r|\\n)*;/g;
const HAS_GOOD_AUDIO_CLIP = /AudioClip\.play\((?:[\s\r\n]|\\r|\\n)*self.getResource\(\).getContent\(\\?"\w+\\?"\)(?:,(?:[\s\r\n]|\\r|\\n)*\{.*?\}(?:[\s\r\n]|\\r|\\n)*)?\)(?:[\s\r\n]|\\r|\\n)*;/g;

const MANUAL_CONTENT_MATCHER = /(\\?")local::\w+\.(\w+)(\\?")/g;


function isEntityOrHScript(fhandle) {
    const is_entity = fhandle.name.endsWith(".entity");
    const is_hscript = fhandle.name.endsWith(".hx");
    return (is_entity || is_hscript);
}

async function countRegexInstances(fhandle, match_re, file_filter) {
    if (!file_filter(fhandle)) return -1;
    // get contents
    const read_handle = await fhandle.getFile();
    var contents = await read_handle.text();
    const matches = ((contents || '').match(match_re) || []);
    return matches.length;
}

async function updateAudioClip(fhandle) {
    const unhandled_locs = await getUnhandledAudioClip(fhandle);
    // get contents
    const read_handle = await fhandle.getFile();
    var contents = await read_handle.text();
    const matches = ((contents || '').match(FIXABLE_AUDIO_CLIP_MATCHER) || []);
    if (matches.length > 0) {
        console.log(`Found ${matches.length} incorrect calls of the form AudioClip.play("id", ...) in ${read_handle.name}`);
        // for (const match of matches) {
        //     console.log(`--- MATCH ::: ${match}`);
        // }
        contents = contents.replace(FIXABLE_AUDIO_CLIP_MATCHER, "$1self.getResource().getContent($2)$3");
        const write_handle = await fhandle.createWritable();
        await write_handle.write(contents);
        await write_handle.close();
    }
    return [...unhandled_locs, matches.length];
}

async function updateManualContentString(fhandle) {
    if (!isEntityOrHScript(fhandle)) return [0];
    // get contents
    const read_handle = await fhandle.getFile();
    var contents = await read_handle.text();
    const matches = ((contents || '').match(MANUAL_CONTENT_MATCHER) || []);
    if (matches.length > 0) {
        console.log(`Found ${matches.length} incorrect content strings in ${read_handle.name}`);
        contents = contents.replace(MANUAL_CONTENT_MATCHER, "self.getResource().getContent($1$2$3)");
        const write_handle = await fhandle.createWritable();
        await write_handle.write(contents);
        await write_handle.close();
    }
    return [matches.length];
}

function unescapeJSONString(encoded_str) {
    return encoded_str.replace("\\b", "\b")
                      .replace("\\f", "\f")
                      .replace("\\n", "\n")
                      .replace("\\r", "\r")
                      .replace("\\t", "\t")
                      .replace("\\\"", "\"")
                      .replace("\\\\", "\\");
}

function getFrameScriptKeyframes(entity_contents) {
    var layer_to_anim_name = new Map();
    for (const anim of entity_contents["animations"]) {
        for (const layer of anim["layers"]) {
            layer_to_anim_name.set(layer, anim["name"]);
        }
    }
    
    var kf_to_layer = new Map();
    for (const layer of entity_contents["layers"]) {
        if (!layer_to_anim_name.has(layer["$id"])) continue;
        for (const kf of layer["keyframes"]) {
            kf_to_layer.set(kf, layer["$id"]);
        }
    }
    
    var kf_to_anim = new Map();
    for (const entry of kf_to_layer) {
        const [kf, layer] = entry;
        kf_to_anim.set(kf, layer_to_anim_name.get(layer) || "unknown");
    }
    
    return kf_to_anim;
}

async function getEntityLocations(read_handle) {
    // format will be `{filename} Animation {animation} FrameScript`
    const loc_base = `${read_handle.name}`
    const entity_contents = JSON.parse(await read_handle.text());
    const keyframes = getFrameScriptKeyframes(entity_contents);
    var locations = [];
    for (const keyframe of entity_contents["keyframes"]) {
        if (!keyframes.has(keyframe["$id"])) continue;
        const code = unescapeJSONString(keyframe["code"] || "");
        const loc_animation = keyframes.get(keyframe["$id"]);
        locations.push([`${loc_base} @ ${loc_animation}`, code]);
    }
    return locations;
}

async function getHScriptLocations(read_handle) {
    return [[read_handle.name, await read_handle.text()]];
}

async function getLocations(fhandle) {
    const is_entity = fhandle.name.endsWith(".entity");
    const is_hscript = fhandle.name.endsWith(".hx");
    if (is_entity) return getEntityLocations(await fhandle.getFile());
    if (is_hscript) return getHScriptLocations(await fhandle.getFile());
    return [];

}

async function getUnhandledAudioClip(fhandle) {
    if (!isEntityOrHScript(fhandle)) return [];
    var matches = [];
    for (const scriptInfo of (await getLocations(fhandle))) {
        const [loc, script] = scriptInfo; // will also convert script into normal new lines
        var line_no = 1;
        for (const line of script.split("\n")) {
            // Find all matches in line and all fixable matches and try to make sure they have the same indices
            var all_matches = line.matchAll(HAS_AUDIO_CLIP_MATCHER);
            for (const line_match of all_matches) {
                const global_sfx_match = [...line.substring(line_match.index).matchAll(HAS_AUDIO_CLIP_GLOBAL_SFX)];
                const is_also_global_sfx = global_sfx_match.length && (global_sfx_match[0].index == 0);
                if (is_also_global_sfx) continue;
                const fixable_match = [...line.substring(line_match.index).matchAll(FIXABLE_AUDIO_CLIP_MATCHER)];
                const is_fixable = fixable_match.length && (fixable_match[0].index == 0);
                if (is_fixable) continue;
                const good_audio_match = [...line.substring(line_match.index).matchAll(HAS_GOOD_AUDIO_CLIP)];
                const is_good_audio = good_audio_match.length && (good_audio_match[0].index == 0);
                if (is_good_audio) continue;
                matches.push([`${loc} line ${line_no}`, line]);
                break;
            }
            line_no += 1;
        }
    }
    return matches;
}

async function applyForFolder(dirHandle, func) {
    allRet = [];
    for await (const entry of dirHandle.values()) {
        if (entry.kind == 'file') {
            allRet.push(await func(entry));
        }
        else if (entry.kind == 'directory') {
            // recursion should be optional and have a max depth
            allRet = allRet.concat(await applyForFolder(entry, func));
        }
    }
    return allRet;
}

function combineReturnValues(ret_values) {
    var num_matches = 0;
    var all_unmatched = [];
    for (const ret_value of ret_values) {
        num_matches += ret_value.pop();
        all_unmatched = all_unmatched.concat(ret_value);
    }
    console.log(all_unmatched);
    console.log(num_matches);
    return [all_unmatched, num_matches];
}

function returnValueToHTML(ret_value, type_str) {
    const [all_unmatched, num_matches] = ret_value;
    if (num_matches == 0 && all_unmatched.length == 0) return;
    const unmatched_loc_html = all_unmatched.map(loc => `<code>${loc[0]}<br>${loc[1]}</code>`).join("<br><br>");
    const unmatched_html = all_unmatched.length ? `<br>Wasn't able to change these matches:<br>${unmatched_loc_html}` : "";
    console.log(unmatched_html);
    return `fixed <span>${num_matches}</span> matches of ${type_str}.${unmatched_html}`;
}

window.addEventListener("load", (e) => {
    const result_box = document.getElementById("result");
    const start_button = document.getElementById("start_process");
    const can_modify_fs = ("showDirectoryPicker"  in window);
    if (can_modify_fs) {
        start_button.addEventListener("click", async (event) => {
            window.showDirectoryPicker({ id: "ft_folder", mode: "readwrite" }).then(async (dirHandle) => {
                for await (const entry of dirHandle.values()) {
                    if (entry.name.endsWith(".fraytools")) return dirHandle;
                }
                throw "Couldn't find .fraytools file";
            }).then(async (dirHandle) => {
                const content_str_res = combineReturnValues(await applyForFolder(dirHandle, updateManualContentString));
                const audio_clip_res = combineReturnValues(await applyForFolder(dirHandle, updateAudioClip));
                return [audio_clip_res, content_str_res];
            }).then((res) => {
                const [audio_clip_res, content_str_res] = res;
                const audio_clip_html = returnValueToHTML(audio_clip_res, "AudioClip.play") || "found no AudioClip to fix automatically.";
                const content_str_html = returnValueToHTML(content_str_res, "local::{resourceId}.{contentId}") || "";
                const content_prefix = (content_str_html && "First, ");
                const audio_clip_prefix = ((content_str_html && "<br>Then s") || "S") + "ucessfully ";
                result_box.innerHTML = `${content_prefix}${content_str_html}${audio_clip_prefix}${audio_clip_html}`;
                result_box.classList = "desc success_resp";
                console.log("Successfully applied to folder");
            }).catch( (err) => {
                if (!(err instanceof DOMException && err.name == "AbortError")) {
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