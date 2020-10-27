/*
 * Copyright (C) 2020 Pixie Brix, LLC
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { recordError } from "@/background/logging";
import { MessageContext, SerializedError } from "@/core";
import { serializeError } from "serialize-error";

function selectError(exc: unknown): SerializedError {
  if (exc instanceof Error) {
    return serializeError(exc);
  } else if (typeof exc === "object") {
    const obj = exc as Record<string, unknown>;
    if (obj.type === "unhandledrejection") {
      return serializeError({
        // @ts-ignore: OK given the type of reason on unhandledrejection
        message: obj.reason?.message ?? "Uncaught error in promise",
      });
    } else {
      return serializeError(obj);
    }
  } else {
    return serializeError(exc);
  }
}

export async function reportError(
  exc: unknown,
  context?: MessageContext
): Promise<void> {
  // Wrap in try/catch, otherwise will enter infinite loop on unhandledrejection when
  // messaging the background script
  try {
    await recordError(selectError(exc), context, null);
  } catch (exc) {
    console.error(`Another error occurred while reporting an error: ${exc}`);
  }
}
