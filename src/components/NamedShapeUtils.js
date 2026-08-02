import React from "react";
import {
  NoteShapeUtil,
  TextShapeUtil,
  ImageShapeUtil,
  EmbedShapeUtil,
} from "tldraw";
import { WithNameTag } from "./WithNameTag";

export function createNamedShapeUtils({ getActorLabelForShape }) {
  const getName = (shape) =>
    getActorLabelForShape?.(shape.id) ||
    shape?.meta?.createdByName ||
    shape?.meta?.createdBy ||
    "Unknown";

  class NamedNote extends NoteShapeUtil {
    static type = "note";
    component(shape) {
      return (
        <WithNameTag
          base={super.component(shape)}
          name={getName(shape)}
          placement="below"
        />
      );
    }
  }

  class NamedText extends TextShapeUtil {
    static type = "text";
    component(shape) {
      return (
        <WithNameTag
          base={super.component(shape)}
          name={getName(shape)}
          placement="below"
        />
      );
    }
  }

  class NamedImage extends ImageShapeUtil {
    static type = "image";
    component(shape) {
      return (
        <WithNameTag
          base={super.component(shape)}
          name={getName(shape)}
          placement="below"
        />
      );
    }
  }

  // Same name tag as images, now also on map/YouTube (and any other
  // provider's) embeds — see CollaborativeWhiteboard.js's "url" external
  // content handler, which creates these via getEmbedInfo.
  class NamedEmbed extends EmbedShapeUtil {
    static type = "embed";
    component(shape) {
      return (
        <WithNameTag
          base={super.component(shape)}
          name={getName(shape)}
          placement="below"
        />
      );
    }
  }

  return { NamedNote, NamedText, NamedImage, NamedEmbed };
}
