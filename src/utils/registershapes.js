import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  collection,
  addDoc,
  writeBatch,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

import { db, storage } from "../firebaseConfig";

function scheduleImageUrlBackfill({ editor, userContext, shapeId, assetId }) {
  // Try a few times, spaced out
  const MAX_TRIES = 5;
  const DELAY_MS = 300;

  let attempt = 0;

  const tryOnce = async () => {
    attempt += 1;
    if (!editor || !assetId) return;

    const asset = editor.getAsset(assetId);
    console.log(
      `[backfillImageUrl] attempt ${attempt}, assetId=${assetId}, asset:`,
      asset
    );

    const src = asset?.props?.src;
    if (src && typeof src === "string" && src.length > 0) {
      console.log(
        "[backfillImageUrl] Got asset.props.src, calling upsertImageUrl"
      );

      const firebaseUrl = await upsertImageUrl(userContext, shapeId, { src });

      if (firebaseUrl) {
        // Optionally also update the tldraw shape so resolveImageUrl sees it
        const shape = editor.getShape(shapeId);
        if (shape) {
          editor.updateShape({
            id: shapeId,
            type: shape.type,
            props: {
              ...shape.props,
              url: firebaseUrl,
            },
          });
        }
      }
      return; // success, stop
    }

    if (attempt < MAX_TRIES) {
      setTimeout(tryOnce, DELAY_MS);
    } else {
      console.warn(
        "[backfillImageUrl] Gave up waiting for asset.src for shape:",
        shapeId
      );
    }
  };

  setTimeout(tryOnce, DELAY_MS);
}

const pickUrlFromProps = (props) => {
  console.log("pickUrlFromProps props =", props);
  if (!props) return null;
  // Prefer 'src' for backward compatibility, then 'url', then 'imageUrl'
  return (
    props?.src ||
    props?.url ||
    props?.imageUrl ||
    props?.source ||
    props?.link ||
    props?.dataURL ||
    props?.dataUrl ||
    props?.imageSrc ||
    props?.imageSrcUrl ||
    props?.imageSource ||
    null
  );
};

//Looks for a real File/Blob carried in props
function pickFileFromProps(props) {
  if (!props) return null;
  if (props.file instanceof File) return props.file;
  if (props.blob instanceof Blob) return props.blob;
  return null;
}

function sanitizePathPart(s) {
  // safe folder names; keep nice looking folders that mirror your whiteboard URL
  return encodeURIComponent(String(s ?? "").trim() || "unknown");
}

function guessExtFromMime(mime, fallback = "bin") {
  if (!mime) return fallback;
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  return fallback;
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}

export async function ensureImageInStorageAndGetUrl({
  userContext,
  shapeId,
  props,
}) {
  const { className, projectName, teamName } = userContext;

  console.groupCollapsed(
    "%censureImageInStorageAndGetUrl",
    "color:#2196f3;font-weight:bold"
  );
  console.log("userContext:", userContext);
  console.log("shapeId:", shapeId);
  console.log("props:", props);

  let fileOrBlob = pickFileFromProps(props);
  let original = pickUrlFromProps(props);
  console.log("fileOrBlob:", fileOrBlob);
  console.log("original URL candidate:", original);

  if (!fileOrBlob && typeof original === "string") {
    if (/^data:image\//i.test(original)) {
      console.log("Converting data:image URL to Blob...");
      fileOrBlob = await dataUrlToBlob(original);
    } else if (/^blob:/i.test(original)) {
      console.log("Converting blob: URL to Blob...");
      fileOrBlob = await dataUrlToBlob(original);
    }
  }

  // data URL → Blob
  // if (
  //   !fileOrBlob &&
  //   typeof original === "string" &&
  //   /^data:image\//i.test(original)
  // ) {
  //   console.log("Converting data URL to Blob...");
  //   fileOrBlob = await dataUrlToBlob(original);
  // }

  // already hosted URL
  if (
    !fileOrBlob &&
    typeof original === "string" &&
    /^https?:\/\//i.test(original)
  ) {
    console.log("Already hosted https URL, returning as-is:", original);
    console.groupEnd();
    return original;
  }

  if (!fileOrBlob) {
    console.log("No file/blob or usable URL; aborting upload.");
    console.groupEnd();
    return null;
  }

  const mime = fileOrBlob.type || "application/octet-stream";
  const ext = guessExtFromMime(mime, "png");

  const path = [
    "upload",
    sanitizePathPart(className),
    sanitizePathPart(projectName),
    sanitizePathPart(teamName),
    `${sanitizePathPart(shapeId)}.${ext}`,
  ].join("/");

  console.log("Uploading to Firebase Storage path:", path);

  const ref = storageRef(storage, path);
  await uploadBytes(ref, fileOrBlob, { contentType: mime });
  const url = await getDownloadURL(ref);

  console.log("✅ Uploaded; download URL:", url);
  console.groupEnd();
  return url;
}

// export async function ensureImageInStorageAndGetUrl({
//   userContext,
//   shapeId,
//   props,
// }) {
//   const { className, projectName, teamName } = userContext;

//   let fileOrBlob = pickFileFromProps(props);
//   let original = pickUrlFromProps(props);

//   // data URL → Blob
//   if (
//     !fileOrBlob &&
//     typeof original === "string" &&
//     /^data:image\//i.test(original)
//   ) {
//     fileOrBlob = await dataUrlToBlob(original);
//   }

//   // already hosted URL
//   if (
//     !fileOrBlob &&
//     typeof original === "string" &&
//     /^https?:\/\//i.test(original)
//   ) {
//     return original;
//   }

//   if (!fileOrBlob) return null;

//   const mime = fileOrBlob.type || "application/octet-stream";
//   const ext = guessExtFromMime(mime, "png");

//   const path = [
//     "upload",
//     sanitizePathPart(className),
//     sanitizePathPart(projectName),
//     sanitizePathPart(teamName),
//     `${sanitizePathPart(shapeId)}.${ext}`,
//   ].join("/");

//   const ref = storageRef(storage, path);
//   await uploadBytes(ref, fileOrBlob, { contentType: mime });
//   return await getDownloadURL(ref);
// }
// props?.src || props?.url || props?.imageUrl || null;

/**
 * Registers a shape in Firestore under the correct classroom/project/team.
 *
 * @param {Object} newShape - The shape information.
 * @param {string} newShape.id - The unique shape ID.
 * @param {string} newShape.type - The type of shape (e.g., rectangle, circle).
 * @param {Object} userContext - The user’s context.
 * @param {string} userContext.className - The classroom ID.
 * @param {string} userContext.projectName - The project name.
 * @param {string} userContext.teamName - The team name.
 * @param {string} userContext.userId - The ID of the user adding the shape.
 * @returns {Promise<void>} A promise that resolves when the shape is successfully stored.
 */

export async function logAction(
  userContext,
  logMessage,
  shapeId,
  shapeType,
  onLogged = () => {}
) {
  if (!userContext) {
    console.error("❌ Missing userContext");
  }
  if (!logMessage) {
    console.error("❌ Missing logMessage");
  }
  if (!shapeId) {
    console.error("❌ Missing shapeId");
  }
  if (!shapeType) {
    console.error("❌ Missing shapeType");
  }

  const { className, projectName, teamName, userId } = userContext;
  // console.log(
  //   `className = ${className} projectName = ${projectName} teamName= ${teamName}`
  // );

  const shapeRef = doc(
    db,
    "classrooms",
    className,
    "Projects",
    projectName,
    "teams",
    teamName,
    "shapes",
    shapeId
  );

  const shapeSnap = await getDoc(shapeRef);
  const shape = shapeSnap.data();
  const actorId = shape?.createdBy || userId || "unknown";

  const cleanAction = logMessage.replace(/\s+/g, "_").toLowerCase();

  const historyID = `${actorId}_${cleanAction}_${shapeId}_${Date.now()}`;
  console.log("History Id === ", historyID);

  try {
    // const historyRef = doc(
    //   db,
    //   `classrooms/${className}/Projects/${projectName}/teams/${teamName}/history/${historyID}`
    // );

    const historyRef = doc(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "history",
      historyID
    );

    // const historyDoc = {
    //   action: logMessage,
    //   timestamp: serverTimestamp(),
    //   userId: userId,
    //   shapeId: shapeId,
    //   shapeType: shapeType || "unknown",
    // };

    await setDoc(historyRef, {
      action: logMessage,
      timestamp: serverTimestamp(),
      userId: actorId,
      shapeId,
      shapeType: shapeType || "unknown",
    });

    // console.log(
    //   `---history doc --- ${historyDoc.action} --- ${historyDoc.userId} --- ${historyDoc.shapeType} --- ${historyDoc.timestamp}`
    // );

    console.log(
      `✅ Log added: ${logMessage} by creator ${actorId} on shape ${shapeId}`
    );

    // await setDoc(historyRef, historyDoc);

    // console.log(`✅ Log added: ${logMessage}`);
    console.log("Action logged by creator:", actorId);

    onLogged();
  } catch (error) {
    console.error(`Error adding log: ${error.message}`);
  }
}

export async function registerShape(newShape, userContext, editor) {
  if (!newShape || !userContext) {
    console.error("❌ Missing shape data or user context.");
    return;
  }

  const { id: shapeID, type: shapeType, x, y, props } = newShape;

  console.log(
    `Registering shape ${shapeID} of type ${shapeType} at position (${x}, ${y}) with props:`,
    props
  );
  const { className, projectName, teamName, userId } = userContext;

  if (
    !shapeID ||
    !shapeType ||
    !className ||
    !projectName ||
    !teamName ||
    !userId
  ) {
    console.error(
      "❌ Missing required fields: shapeID, shapeType, className, projectName, teamName, or userId."
    );
    return;
  }

  try {
    const shapeRef = doc(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "shapes",
      shapeID
    );

    const shapeDoc = {
      shapeId: shapeID,
      shapeType,
      position: { x, y },
      text: props?.text || "",
      color: props?.color || "#000000",
      teamName: teamName,
      createdAt: serverTimestamp(),
      createdBy: userId,
      comments: [],
      reactions: {
        like: [],
        dislike: [],
        surprised: [],
        confused: [],
      },
    };

    let finalImageUrl = null;

    if (shapeType === "image") {
      console.log("[registerShape] handling image shape:", {
        shapeID,
        props,
      });

      let uploadProps = props || {};
      let inlineUrl = pickUrlFromProps(uploadProps);
      let blobFromProps = pickFileFromProps(uploadProps);

      if (!inlineUrl && !blobFromProps && uploadProps.assetId && editor) {
        const asset = editor.getAsset(uploadProps.assetId);
        console.log("[registerShape] asset for image:", asset);

        if (asset && asset.props && asset.props.src) {
          uploadProps = {
            ...uploadProps,
            src: asset.props.src,
          };
          console.log(
            "[registerShape] Using asset.props.src for upload:",
            asset.props.src && asset.props.src.slice(0, 80)
          );
        } else {
          console.log(
            "[registerShape] No asset.src found for assetId:",
            uploadProps.assetId
          );
        }
        inlineUrl = pickUrlFromProps(uploadProps);
        blobFromProps = pickFileFromProps(uploadProps);
      }

      if (inlineUrl || blobFromProps) {
        finalImageUrl = await ensureImageInStorageAndGetUrl({
          userContext,
          shapeId: shapeID,
          props: uploadProps,
        });

        if (!finalImageUrl) {
          finalImageUrl = pickUrlFromProps(uploadProps);
        }

        if (finalImageUrl) {
          console.log(
            "[registerShape] Got finalImageUrl on first try:",
            finalImageUrl
          );
          shapeDoc.url = finalImageUrl;
        }
      }
      if (!finalImageUrl) {
        console.log(
          "⚠️ Image shape has no resolvable URL *yet*; scheduling backfill..."
        );

        if (props?.assetId && editor) {
          scheduleImageUrlBackfill({
            editor,
            userContext,
            shapeId: shapeID,
            assetId: props.assetId,
          });
        }
      }
    }

    // let finalImageUrl = null;

    // if (shapeType === "image") {
    //   console.log("[registerShape] handling image shape:", {
    //     shapeID,
    //     props,
    //   });

    //   // Start from props as-is
    //   let uploadProps = props || {};

    //   // Do we already have a usable URL/file in props?
    //   const inlineUrl = pickUrlFromProps(uploadProps);
    //   const fileOrBlob = pickFileFromProps(uploadProps);

    //   // If not, fall back to the tldraw asset via assetId + editor
    //   if (!inlineUrl && !fileOrBlob && uploadProps.assetId && editor) {
    //     const asset = editor.getAsset(uploadProps.assetId);
    //     console.log("[registerShape] asset for image:", asset);

    //     if (asset && asset.props && asset.props.src) {
    //       // Inject src so ensureImageInStorageAndGetUrl can use it
    //       uploadProps = {
    //         ...uploadProps,
    //         src: asset.props.src,
    //       };
    //       console.log(
    //         "[registerShape] Using asset.props.src for upload:",
    //         asset.props.src.slice(0, 80)
    //       );
    //     } else {
    //       console.log(
    //         "[registerShape] No asset.src found for assetId:",
    //         uploadProps.assetId
    //       );
    //     }
    //   }

    //   // Upload / resolve final URL
    //   finalImageUrl = await ensureImageInStorageAndGetUrl({
    //     userContext,
    //     shapeId: shapeID,
    //     props: uploadProps,
    //   });

    //   if (!finalImageUrl) {
    //     // last fallback: take whatever URL-ish thing we can see
    //     finalImageUrl = pickUrlFromProps(uploadProps);
    //   }

    //   if (finalImageUrl) {
    //     shapeDoc.url = finalImageUrl;
    //     console.log(
    //       "[registerShape] Final image URL stored in Firestore:",
    //       finalImageUrl
    //     );
    //   } else {
    //     console.log("⚠️ Image shape has no resolvable URL.");
    //   }
    // }

    // if (shapeType === "image") {
    //   console.log("Registering image shape with props:", props);

    //   const url = pickUrlFromProps(props);
    //   if (url) {
    //     shapeDoc.url = url;
    //   } else {
    //     console.error(
    //       "⚠️ Image shape registered without a valid URL in props."
    //     );
    //   }
    // }

    // Store data in Firestore
    await setDoc(shapeRef, shapeDoc);
    console.log(`✅ Shape ${shapeID} successfully added to Firestore!`);

    await logAction(userContext, `added `, newShape.id, newShape.type);

    const move = buildMoveFromShape({
      action: "added",
      shape: newShape,
      userId,
      ts: new Date().toISOString(),
      overrideUrl: finalImageUrl || undefined,
    });
    await appendMoveToExportBuffer({ ...userContext, move });

    return finalImageUrl ?? null;
  } catch (error) {
    console.error("❌ Error adding shape to Firestore:", error);
  }
}

// export async function updateShape(shape, userContext) {
//   const { className, projectName, teamName, userId } = userContext;
//   const { id: shapeID, type: shapeType, props, x, y } = shape;

//   console.log(
//     `Updating shape ${shapeID} of type ${shapeType} at position (${x}, ${y}) with props:`,
//     props
//   );

//   // if (!shapeID || !updatedProps || !userContext) {
//   //   console.error("❌ Missing shape ID, updated properties, or user context.");
//   //   return;
//   // }

//   try {
//     const shapeRef = doc(
//       db,
//       `classrooms/${className}/Projects/${projectName}/teams/${teamName}/shapes/${shapeID}`
//     );

//     const updatePayload = {};

//     if (props?.text !== undefined) {
//       updatePayload.text = props.text;
//     }
//     if (props?.color !== undefined) {
//       updatePayload.color = props.color;
//     }
//     // if (props.position) {
//     //   updatePayload.position = props.position;
//     // }
//     if (x !== undefined && y !== undefined) {
//       updatePayload.position = { x, y };
//     }

//     if (shapeType === "image") {
//       console.log("Updating image shape with props:", props);
//       const url = pickUrlFromProps(props);
//       if (url) {
//         updatePayload.url = url;
//       } else {
//         console.log("⚠️ Image shape updated without a valid URL in props.");
//       }
//     }

//     if (Object.keys(updatePayload).length === 0) {
//       console.error("❌ No properties to update.");
//       return;
//     }

//     await updateDoc(shapeRef, updatePayload);
//     console.log(
//       `✅ Shape ${shapeID} successfully updated in Firestore with ${updatePayload}.`
//     );

//     await logAction(userContext, `updated`, userId, shapeID, shapeType);

//     const move = buildMoveFromShape({
//       action: "updated",
//       shape,
//       userId,
//       ts: new Date().toISOString(),
//     });
//     await appendMoveToExportBuffer({ ...userContext, move });
//   } catch (error) {
//     console.error("❌ Error updating shape in Firestore:", error);
//   }
// }

/* ========= NEW: Edit Session Manager ========= */

/**
 * Debounced/throttled session-based updates.
 * - scheduleUpdateShape(): debounced Firestore update (no history)
 * - startEditSession(): mark session start
 * - endEditSession(): single history + single export-buffer move, with dwell
 */

const _debounceTimers = new Map(); // key: shapeId -> timeout
const _lastPayloadHash = new Map(); // key: shapeId -> JSON string
const _lastWriteAt = new Map(); // key: shapeId -> ms
const _sessions = new Map(); // key: shapeId -> { startedAt, firstText, changes, lastText }

const DEBOUNCE_MS = 800; // pause after typing
const DRAG_THROTTLE_MS = 300; // limit position-only writes
const MIN_SIGNIFICANT_DELTA = 3; // skip tiny edits

function hash(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(Math.random());
  }
}

function isSignificantChange(prevText, nextText) {
  const a = (prevText || "").trim();
  const b = (nextText || "").trim();
  if (a === b) return false;
  const delta = Math.abs(b.length - a.length);
  if (delta >= MIN_SIGNIFICANT_DELTA) return true;
  // also treat token-count change as significant
  return b.split(/\s+/).length !== a.split(/\s+/).length;
}

/** call on focus */
export function startEditSession({ shape, userContext }) {
  const key = shape?.id;
  if (!key || _sessions.has(key)) return;
  _sessions.set(key, {
    startedAt: Date.now(),
    firstText: shape?.props?.text || "",
    lastText: shape?.props?.text || "",
    changes: 0,
    userContext,
  });
}

/** call on every change; this DOES NOT log history; it only writes debounced changes */
// export async function scheduleUpdateShape(shape, userContext) {
//   const { className, projectName, teamName } = userContext;
//   const { id: shapeID, type: shapeType, props, x, y } = shape;
//   if (!shapeID) return;

//   // Position-only updates are throttled
//   const onlyPosition =
//     props?.text === undefined &&
//     props?.color === undefined &&
//     props?.url === undefined;
//   if (onlyPosition) {
//     const lastAt = _lastWriteAt.get(shapeID) || 0;
//     if (Date.now() - lastAt < DRAG_THROTTLE_MS) return;
//     _lastWriteAt.set(shapeID, Date.now());
//   }

//   const updatePayload = {};
//   if (props?.text !== undefined) updatePayload.text = props.text;
//   if (props?.color !== undefined) updatePayload.color = props.color;
//   if (x !== undefined && y !== undefined) updatePayload.position = { x, y };

//   if (shapeType === "image") {
//     const url = pickUrlFromProps(props);
//     if (url) updatePayload.url = url;
//   }
//   if (Object.keys(updatePayload).length === 0) return;

//   // Debounce by shape
//   const key = shapeID;
//   const h = hash(updatePayload);
//   if (_lastPayloadHash.get(key) === h) return; // identical to last scheduled

//   _lastPayloadHash.set(key, h);
//   if (_debounceTimers.get(key)) clearTimeout(_debounceTimers.get(key));

//   const timer = setTimeout(async () => {
//     const shapeRef = doc(
//       db,
//       `classrooms/${className}/Projects/${projectName}/teams/${teamName}/shapes/${shapeID}`
//     );
//     await updateDoc(shapeRef, {
//       ...updatePayload,
//       updatedAt: serverTimestamp(),
//     });
//     _lastWriteAt.set(key, Date.now());

//     // update session stats
//     const ses = _sessions.get(key);
//     if (ses) {
//       ses.changes += 1;
//       if (props?.text !== undefined) ses.lastText = props.text || "";
//       _sessions.set(key, ses);
//     }
//   }, DEBOUNCE_MS);

//   _debounceTimers.set(key, timer);
// }

// export async function scheduleUpdateShape(shape, userContext) {
//   const { className, projectName, teamName } = userContext;
//   const { id: shapeID, type: shapeType, props, x, y } = shape;
//   if (!shapeID) return;

//   const onlyPosition =
//     props?.text === undefined &&
//     props?.color === undefined &&
//     props?.url === undefined;
//   if (onlyPosition) {
//     const lastAt = _lastWriteAt.get(shapeID) || 0;
//     if (Date.now() - lastAt < DRAG_THROTTLE_MS) return;
//     _lastWriteAt.set(shapeID, Date.now());
//   }

//   const updatePayload = {};
//   if (props?.text !== undefined) updatePayload.text = props.text;
//   if (props?.color !== undefined) updatePayload.color = props.color;
//   if (x !== undefined && y !== undefined) updatePayload.position = { x, y };

//   if (shapeType === "image") {
//     const candidate = pickUrlFromProps(props);
//     let hostedUrl = null;

//     if (candidate) {
//       if (/^https?:\/\//i.test(candidate)) {
//         hostedUrl = candidate; // safe
//       } else if (/^data:image\//i.test(candidate)) {
//         hostedUrl = await ensureImageInStorageAndGetUrl({
//           userContext,
//           shapeId: shapeID,
//           props,
//         });
//       }
//     }
//     if (hostedUrl) updatePayload.url = hostedUrl;
//     // If we couldn't resolve a hosted URL, skip writing `url`
//   }

//   if (Object.keys(updatePayload).length === 0) return;

//   const key = shapeID;
//   const h = hash(updatePayload);
//   if (_lastPayloadHash.get(key) === h) return;

//   _lastPayloadHash.set(key, h);
//   if (_debounceTimers.get(key)) clearTimeout(_debounceTimers.get(key));

//   const timer = setTimeout(async () => {
//     // const shapeRef = doc(
//     //   db,
//     //   `classrooms/${className}/Projects/${projectName}/teams/${teamName}/shapes/${shapeID}`
//     // );
//     const shapeRef = doc(
//       db,
//       "classrooms",
//       className,
//       "Projects",
//       projectName,
//       "teams",
//       teamName,
//       "shapes",
//       shapeID
//     );
//     // await updateDoc(shapeRef, {
//     //   ...updatePayload,
//     //   updatedAt: serverTimestamp(),
//     // });
//     await setDoc(
//       shapeRef,
//       {
//         shapeId: shapeID,
//         shapeType: shapeType || "unknown",
//         ...updatePayload,
//         updatedAt: serverTimestamp(),
//       },
//       { merge: true }
//     );

//     _lastWriteAt.set(key, Date.now());

//     const ses = _sessions.get(key);
//     if (ses) {
//       ses.changes += 1;
//       if (props?.text !== undefined) ses.lastText = props.text || "";
//       _sessions.set(key, ses);
//     }
//   }, DEBOUNCE_MS);

//   _debounceTimers.set(key, timer);
// }

// export async function scheduleUpdateShape(shape, userContext) {
//   const { className, projectName, teamName } = userContext;
//   const { id: shapeID, type: shapeType, props, x, y } = shape;
//   if (!shapeID) return;

//   const onlyPosition =
//     props?.text === undefined &&
//     props?.color === undefined &&
//     props?.url === undefined;

//   if (onlyPosition) {
//     const lastAt = _lastWriteAt.get(shapeID) || 0;
//     if (Date.now() - lastAt < DRAG_THROTTLE_MS) return;
//     _lastWriteAt.set(shapeID, Date.now());
//   }

//   const updatePayload = {};
//   if (props?.text !== undefined) updatePayload.text = props.text;
//   if (props?.color !== undefined) updatePayload.color = props.color;
//   if (x !== undefined && y !== undefined) updatePayload.position = { x, y };

//   if (shapeType === "image") {
//     const candidate = pickUrlFromProps(props);
//     let hostedUrl = null;

//     if (candidate) {
//       if (/^https?:\/\//i.test(candidate)) {
//         hostedUrl = candidate;
//       } else if (/^data:image\//i.test(candidate)) {
//         hostedUrl = await ensureImageInStorageAndGetUrl({
//           userContext,
//           shapeId: shapeID,
//           props,
//         });
//       }
//     }
//     if (hostedUrl) updatePayload.url = hostedUrl;
//   }

//   if (Object.keys(updatePayload).length === 0) return;

//   const key = shapeID;
//   const h = hash(updatePayload);
//   if (_lastPayloadHash.get(key) === h) return;
//   _lastPayloadHash.set(key, h);

//   if (_debounceTimers.get(key)) clearTimeout(_debounceTimers.get(key));

//   const timer = setTimeout(async () => {
//     const shapeRef = doc(
//       db,
//       "classrooms",
//       className,
//       "Projects", // ✅ make sure this is plural everywhere
//       projectName,
//       "teams",
//       teamName,
//       "shapes",
//       shapeID
//     );

//     await setDoc(
//       shapeRef,
//       {
//         // these two are helpful if the doc did not exist yet:
//         shapeId: shapeID,
//         shapeType: shapeType || "unknown",
//         // actual updates:
//         ...updatePayload,
//         updatedAt: serverTimestamp(),
//       },
//       { merge: true }
//     );

//     _lastWriteAt.set(key, Date.now());

//     const ses = _sessions.get(key);
//     if (ses) {
//       ses.changes += 1;
//       if (props?.text !== undefined) ses.lastText = props.text || "";
//       _sessions.set(key, ses);
//     }
//   }, DEBOUNCE_MS);

//   _debounceTimers.set(key, timer);
// }

export async function scheduleUpdateShape(shape, userContext) {
  const { className, projectName, teamName } = userContext || {};
  const { id: shapeID, type: shapeType, props, x, y } = shape || {};
  if (!shapeID || !className || !projectName || !teamName) return;

  // Throttle position-only moves
  const onlyPosition =
    props?.text === undefined &&
    props?.color === undefined &&
    props?.url === undefined;

  if (onlyPosition) {
    const lastAt = _lastWriteAt.get(shapeID) || 0;
    if (Date.now() - lastAt < DRAG_THROTTLE_MS) return;
    _lastWriteAt.set(shapeID, Date.now());
  }

  const updatePayload = {};
  if (props?.text !== undefined) updatePayload.text = props.text;
  if (props?.color !== undefined) updatePayload.color = props.color;
  if (x !== undefined && y !== undefined) updatePayload.position = { x, y };

  if (shapeType === "image") {
    const candidate = pickUrlFromProps(props);
    let hostedUrl = null;

    if (candidate) {
      if (/^https?:\/\//i.test(candidate)) {
        hostedUrl = candidate;
      } else if (/^data:image\//i.test(candidate)) {
        hostedUrl = await ensureImageInStorageAndGetUrl({
          userContext,
          shapeId: shapeID,
          props,
        });
      }
    }
    if (hostedUrl) updatePayload.url = hostedUrl;
  }

  if (Object.keys(updatePayload).length === 0) return;

  const key = shapeID;
  const h = hash(updatePayload);
  if (_lastPayloadHash.get(key) === h) return;
  _lastPayloadHash.set(key, h);

  if (_debounceTimers.get(key)) clearTimeout(_debounceTimers.get(key));

  const timer = setTimeout(async () => {
    const shapeRef = doc(
      db,
      "classrooms",
      className,
      "Projects", // ✅ make sure this is plural everywhere
      projectName,
      "teams",
      teamName,
      "shapes",
      shapeID
    );

    // 🔴 NEW: only update if the doc already exists
    const snap = await getDoc(shapeRef);
    if (!snap.exists()) {
      console.log(
        "[scheduleUpdateShape] Skip update for new shape (no doc yet):",
        shapeID
      );
      return;
    }

    await updateDoc(shapeRef, {
      ...updatePayload,
      updatedAt: serverTimestamp(),
    });
    _lastWriteAt.set(key, Date.now());

    const ses = _sessions.get(key);
    if (ses) {
      ses.changes += 1;
      if (props?.text !== undefined) ses.lastText = props.text || "";
      _sessions.set(key, ses);
    }
  }, DEBOUNCE_MS);

  _debounceTimers.set(key, timer);
}

/** call on blur/Enter (commit); this DOES log history + export move (once) */
export async function endEditSession({ shape, userContext, userId }) {
  const key = shape?.id;
  const ses = _sessions.get(key);
  if (!ses) return;

  // Flush pending debounced write (if any)
  if (_debounceTimers.get(key)) {
    clearTimeout(_debounceTimers.get(key));
    _debounceTimers.delete(key);
    // Fire a final immediate write of the last known values:
    await scheduleUpdateShape(shape, userContext);
  }

  const durationMs = Date.now() - ses.startedAt;
  const prev = ses.firstText;
  const next = shape?.props?.text || "";
  _sessions.delete(key);

  if (!isSignificantChange(prev, next)) {
    return false;
  }

  // Skip trivial edits
  // if (!isSignificantChange(prev, next)) return;

  // Single history + single export move (batch for atomicity)
  const { className, projectName, teamName } = userContext;
  const batch = writeBatch(db);

  // history doc
  const cleanAction = "updated";
  const historyId = `${userId}_${cleanAction}_${key}_${Date.now()}`;
  const historyRef = doc(
    db,
    `classrooms/${className}/Projects/${projectName}/teams/${teamName}/history/${historyId}`
  );
  batch.set(historyRef, {
    action: "updated",
    timestamp: serverTimestamp(),
    userId,
    shapeId: key,
    shapeType: shape?.type || "unknown",
    _session_dwell_ms: durationMs,
    _session_changes: ses.changes,
  });

  await batch.commit();

  const move = buildMoveFromShape({
    action: "updated",
    shape,
    userId,
    ts: new Date().toISOString(),
  });
  move.micro = {
    ...move.micro,
    dwell_ms: durationMs,
    reselect_count: ses.changes,
  };
  await appendMoveToExportBuffer({ ...userContext, move });

  return true;
}

/**
 * Deletes a shape from Firestore.
 *
 * @param {string} shapeID - The unique ID of the shape to delete.
 * @param {Object} userContext - The user’s context (classroom, project, team).
 * @param {string} userContext.className - Classroom ID.
 * @param {string} userContext.projectName - Project Name.
 * @param {string} userContext.teamName - Team Name.
 * @returns {Promise<void>} A promise that resolves when the shape is deleted.
 */
export async function deleteShape(shapeID, userContext) {
  if (!shapeID || !userContext) {
    console.error("❌ Missing shape ID or user context.");
    return;
  }
  // const { id: shapeID, type: shapeType } = newShape;
  const { className, projectName, teamName, userId } = userContext;

  try {
    // Firestore document reference
    // const shapeRef = doc(
    //   db,
    //   `classrooms/${className}/Projects/${projectName}/teams/${teamName}/shapes/${shapeID}`
    // );
    const shapeRef = doc(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "shapes",
      shapeID
    );

    // Delete document
    await deleteDoc(shapeRef);
    console.log(`🗑️ Shape ${shapeID} successfully deleted from Firestore.`);
    await logAction(userContext, `deleted`, shapeID, "unknown");

    const move = buildMoveFromShape({
      action: "deleted",
      shape: { id: shapeID, type: "unknown", props: {} },
      userId,
      ts: new Date().toISOString(),
    });
    await appendMoveToExportBuffer({ ...userContext, move });
  } catch (error) {
    console.error("❌ Error deleting shape from Firestore:", error);
  }
}

// export async function upsertImageUrl(userContext, shapeId, urlOrProps) {
//   if (!userContext || !shapeId || !urlOrProps) return;
//   const { className, projectName, teamName } = userContext;

//   let finalUrl = null;

//   if (typeof urlOrProps === "string") {
//     if (/^https?:\/\//i.test(urlOrProps)) {
//       // already hosted, safe to store
//       finalUrl = urlOrProps;
//     } else if (/^data:image\//i.test(urlOrProps)) {
//       // convert & upload, then get https URL
//       finalUrl = await ensureImageInStorageAndGetUrl({
//         userContext,
//         shapeId,
//         props: { dataUrl: urlOrProps },
//       });
//     } else {
//       console.warn("upsertImageUrl: unsupported url format, skipping");
//       return;
//     }
//   } else {
//     // treat as props object with file/blob/dataUrl/src...
//     finalUrl = await ensureImageInStorageAndGetUrl({
//       userContext,
//       shapeId,
//       props: urlOrProps,
//     });
//   }

//   if (!finalUrl) return;

//   // const shapeRef = doc(
//   //   db,
//   //   `classrooms/${className}/Projects/${projectName}/teams/${teamName}/shapes/${shapeId}`
//   // );

//   const shapeRef = doc(
//     db,
//     "classrooms",
//     className,
//     "Projects",
//     projectName,
//     "teams",
//     teamName,
//     "shapes",
//     shapeId
//   );

//   await setDoc(
//     shapeRef,
//     { shapeId, url: finalUrl, updatedAt: serverTimestamp() },
//     { merge: true }
//   );
// }

export async function upsertImageUrl(userContext, shapeId, urlOrProps) {
  console.groupCollapsed(
    `%cupsertImageUrl() called`,
    "color:#4caf50;font-weight:bold"
  );
  console.log("userContext:", userContext);
  console.log("shapeId:", shapeId);
  console.log("urlOrProps:", urlOrProps);

  if (!userContext || !shapeId || !urlOrProps) {
    console.warn("❌ Missing required argument.");
    console.groupEnd();
    return null;
  }

  const { className, projectName, teamName } = userContext;
  console.log("Resolved path:", {
    className,
    projectName,
    teamName,
  });

  let finalUrl = null;

  try {
    // ----------------------------
    // CASE 1: urlOrProps is a string
    // ----------------------------
    if (typeof urlOrProps === "string") {
      console.log("urlOrProps is a string:", urlOrProps);

      if (/^https?:\/\//i.test(urlOrProps)) {
        console.log("➡️ Already a hosted HTTPS URL. Using directly.");
        finalUrl = urlOrProps;
      } else if (/^data:image\//i.test(urlOrProps)) {
        console.log("➡️ Detected data:image/* URL — uploading to Firebase...");
        finalUrl = await ensureImageInStorageAndGetUrl({
          userContext,
          shapeId,
          props: { dataUrl: urlOrProps },
        });
        console.log("Uploaded dataURL → finalUrl:", finalUrl);
      } else {
        console.warn("❌ Unsupported format (neither https nor data:image/)");
        console.groupEnd();
        return null;
      }
    }

    // ----------------------------
    // CASE 2: urlOrProps is props object
    // ----------------------------
    else {
      console.log("urlOrProps is an object:", urlOrProps);
      finalUrl = await ensureImageInStorageAndGetUrl({
        userContext,
        shapeId,
        props: urlOrProps,
      });
      console.log("Uploaded from props → finalUrl:", finalUrl);
    }

    if (!finalUrl) {
      console.error("❌ No finalUrl produced by upload logic.");
      console.groupEnd();
      return null;
    }

    // ----------------------------
    // WRITE TO FIRESTORE
    // ----------------------------
    const shapeRef = doc(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "shapes",
      shapeId
    );

    console.log("📤 Writing to Firestore at:", shapeRef.path);
    console.log("Firestore payload:", {
      shapeId,
      url: finalUrl,
    });

    await setDoc(
      shapeRef,
      { shapeId, url: finalUrl, updatedAt: serverTimestamp() },
      { merge: true }
    );

    console.log("✅ Firestore write complete.");
    console.log("🔁 Returning finalUrl:", finalUrl);
  } catch (err) {
    console.error("💥 Error in upsertImageUrl:", err);
  }

  console.groupEnd();
  return finalUrl;
}

/** Convert a userId into a small actor index (0/1/2...) deterministically. */
function actorIndex(userId) {
  // Stable but simple hash → small bucket
  let h = 0;
  for (let i = 0; i < (userId || "").length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return h % 3; // 0..2
}

/** Best-effort tags from text */
function tagify(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * Append one move into an append-only buffer:
 * teams/{TEAM}/export_buffer/moves/{autoId}
 */
export async function appendMoveToExportBuffer({
  className,
  projectName,
  teamName,
  move, // object in linkograph "move" shape (below)
}) {
  const movesCol = collection(
    db,
    `classrooms/${className}/Projects/${projectName}/teams/${teamName}/export_buffer`
  );
  await addDoc(movesCol, {
    ...move,
    // server authoritative write time for ordering if client timestamps vary
    _serverAt: serverTimestamp(),
  });
}

/**
 * Build a normalized "move" from a shape action.
 * action: "added" | "updated" | "deleted"
 */
export function buildMoveFromShape({
  action,
  shape,
  userId,
  ts = new Date().toISOString(),
  overrideUrl,
}) {
  const a = action?.toLowerCase() || "edit";
  const t = ts; // ISO string (client time); server ordering via _serverAt
  const shapeType = shape?.type || "unknown";
  const text = shape?.props?.text || "";

  const urlFromProps =
    shape?.props?.src ||
    shape?.props?.url ||
    shape?.props?.imageUrl ||
    shape?.props?.imageSrc ||
    null;

  const url = overrideUrl ?? urlFromProps ?? null;

  // const url =
  //   shape?.props?.src ||
  //   shape?.props?.url ||
  //   shape?.props?.imageUrl ||
  //   shape?.props?.imageSrc ||
  //   null;

  return {
    text: text || `${a} ${shapeType}`,
    actor: actorIndex(userId),
    timestamp: t,
    action: a,
    itemType: shapeType,
    items: [shape?.id].filter(Boolean),
    content: {
      text,
      imageUrls: url ? [url] : [],
      tags: tagify(text),
    },
    micro: {
      pointer_path_px: null,
      dwell_ms: null,
      reselect_count: null,
      hover_ms: null,
      scrub_px: null,
      dx: null,
      dy: null,
    },
    tempo: {
      gap_prev_ms: null,
      apm_rolling: null,
      velocity_px_s: null,
    },
  };
}
