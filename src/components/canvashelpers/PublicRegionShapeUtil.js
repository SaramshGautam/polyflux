import * as React from "react";
import { BaseBoxShapeUtil, HTMLContainer, Rectangle2d } from "tldraw";

export class PublicRegionShapeUtil extends BaseBoxShapeUtil {
  static type = "public-region";

  getDefaultProps() {
    return {
      w: 320,
      h: 220,
      label: "Common Space",
    };
  }

  getGeometry(shape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  component(shape) {
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          border: "2px dashed #2563eb",
          background: "rgba(37, 99, 235, 0.08)",
          borderRadius: 12,
          boxSizing: "border-box",
          position: "relative",
          pointerEvents: "all",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 10,
            fontSize: 12,
            fontWeight: 600,
            color: "#1d4ed8",
            background: "rgba(255,255,255,0.85)",
            padding: "2px 8px",
            borderRadius: 999,
          }}
        >
          {shape.props.label || "Common Space"}
        </div>
      </HTMLContainer>
    );
  }

  indicator(shape) {
    return (
      <rect width={shape.props.w} height={shape.props.h} rx={12} ry={12} />
    );
  }

  canBind() {
    return false;
  }

  canEdit() {
    return true;
  }
}
