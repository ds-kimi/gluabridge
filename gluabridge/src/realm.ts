import * as path from "path";
import { Realm } from "./protocol";

/**
 * Guesses the realm from a gmod addon path.
 *
 * Server-realm files are deliberately mapped to client: an injected client has
 * no server lua_State, and running sv_ code clientside is a more useful failure
 * (a visible lua error) than a silent no-op.
 */
export function realmFor(filePath: string, fallback: Realm): Realm {
    const normalized = filePath.split("\\").join("/").toLowerCase();
    const name = path.basename(normalized);

    if (name.startsWith("menu_") || /\/(menu)\//.test(normalized)) {
        return "menu";
    }

    if (
        name.startsWith("cl_") ||
        name.startsWith("sh_") ||
        /\/(client|shared|vgui|derma)\//.test(normalized)
    ) {
        return "client";
    }

    return fallback;
}
