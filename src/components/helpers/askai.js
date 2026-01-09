export function extractShapeText(shape) {
  if (!shape) return "";
  if (shape.props?.text) return String(shape.props.text);

  const rt = shape.props?.richText?.content;
  if (Array.isArray(rt) && rt[0]?.content?.[0]?.text) {
    return String(rt[0].content[0].text);
  }
  return "";
}

// helpers/askai.ts

const isWebUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u.trim());

export function resolveImageUrl(editor, shape) {
  if (!shape) return null;
  const p = shape.props || {};

  console.log("---------- resolveImageUrl DEBUG ----------");
  console.log("[resolveImageUrl] SHAPE:", shape);
  console.log("[resolveImageUrl] SHAPE.props:", p);

  console.log("[resolveImageUrl] Direct props:", {
    imageUrl: p.imageUrl,
    url: p.url,
    src: p.src,
    assetId: p.assetId,
  });

  const candidates = [
    p.imageUrl, // ✅ look on props
    p.url,
    p.src,
  ];

  // Asset-based URLs
  const assetId = p.assetId;
  if (assetId) {
    console.log("[resolveImageUrl] Trying assetId:", assetId);

    const assetViaEditor = editor.getAsset?.(assetId);
    console.log("[resolveImageUrl] editor.getAsset:", assetViaEditor);

    const storeAsset =
      editor.store?.get?.asset?.(assetId) ??
      editor.store?.get?.({ id: assetId, typeName: "asset" });
    console.log("[resolveImageUrl] editor.store.get asset:", storeAsset);

    if (assetViaEditor) {
      candidates.push(assetViaEditor.props?.src, assetViaEditor.src);
    }
    if (storeAsset) {
      candidates.push(storeAsset.props?.src, storeAsset.src);
    }
  }

  // Filter out empty strings / nulls and pick first real web URL
  const firstWeb =
    candidates
      .filter((c) => typeof c === "string" && c.trim().length > 0)
      .find(isWebUrl) ?? null;

  console.log("[resolveImageUrl] Candidate URLs:", candidates);
  console.log("[resolveImageUrl] First resolved web URL:", firstWeb);
  console.log("-------------------------------------------");

  return firstWeb;
}

// export function resolveImageUrl(editor, shape) {
//   if (!shape) return null;
//   const p = shape.props || {};

//   if (p.src) return p.src;
//   if (p.url) return p.url;
//   if (p.imageUrl) return p.imageUrl;

//   const assetId = p.assetId;
//   if (assetId) {
//     const assetViaEditor = editor.getAsset?.(assetId);
//     const fromEditor =
//       assetViaEditor?.props?.src ?? assetViaEditor?.src ?? null;
//     if (fromEditor) return fromEditor;

//     const storeAsset =
//       editor.store?.get?.asset?.(assetId) ??
//       editor.store?.get?.({ id: assetId, typeName: "asset" });
//     const fromStore = storeAsset?.props?.src ?? storeAsset?.src ?? null;
//     if (fromStore) return fromStore;
//   }

//   return null;
// }

// --- Selection summary for Ask AI / Chat ---

export function makeSelectionSummary(editor) {
  const ids = editor.getSelectedShapeIds();
  const shapes = ids.map((id) => editor.getShape(id)).filter(Boolean);

  const summaries = shapes.map((s) => ({
    id: s.id,
    type: s.type,
    url: s.type === "image" ? resolveImageUrl(editor, s) : undefined,
    text: extractShapeText(s),
    label: (
      s.props?.title ??
      s.props?.name ??
      s.props?.text ??
      s.props?.richText?.content?.[0]?.content?.[0]?.text ??
      ""
    )
      .toString()
      .slice(0, 60),
  }));

  // console.log("[makeSelectionSummary] Input shapes:", shapes);
  // console.log("[makeSelectionSummary] Extracted summaries:", summaries);

  const bounds =
    editor.getSelectionPageBounds?.() ??
    editor.getSelectedPageBounds?.() ??
    null;

  return {
    ids,
    summaries,
    primary: summaries.length === 1 ? summaries[0] : null,
    bounds,
  };
}

// --- Ask-AI positioning & payload building ---

export function screenPointForSelection(editor, bounds) {
  const pagePoint = bounds
    ? { x: bounds.maxX + 10, y: bounds.maxY - 30 }
    : editor.getViewportPageCenter?.() ?? { x: 0, y: 0 };

  const sp = editor.pageToScreen(pagePoint);

  return {
    x: Math.min(sp.x, window.innerWidth - 400),
    y: Math.min(sp.y, window.innerHeight - 500),
  };
}

export function buildAiPayloadFromSelection(selection, editor) {
  const { summaries = [], primary, bounds } = selection || {};
  const position = screenPointForSelection(editor, bounds);

  if (primary) {
    const snippet =
      primary.type === "image"
        ? primary.url || "image"
        : primary.text || primary.label || "";

    const image_urls =
      primary.type === "image" && primary.url ? [primary.url] : [];

    return {
      snippet,
      source: primary.id,
      position,
      image_urls,
      meta: { type: primary.type, selection: summaries },
    };
  }

  // Multi-select
  const items = summaries.map((s, i) => ({
    id: s.id,
    type: s.type,
    text: (s.text || s.label || "").slice(0, 200),
    url: s.type === "image" ? s.url : undefined,
    idx: i + 1,
  }));

  const textualSummary = items
    .map(
      (it) =>
        `${it.idx}. ${it.type}` +
        (it.text ? `: ${it.text}` : "") +
        (it.url ? ` [${String(it.url).slice(0, 60)}...]` : "")
    )
    .join("\n");

  const image_urls = items.map((it) => it.url).filter(Boolean);

  return {
    snippet: `Selected ${items.length} items:\n${textualSummary}`,
    source: items.map((it) => it.id),
    position,
    image_urls,
    meta: { selection: items },
  };
}
