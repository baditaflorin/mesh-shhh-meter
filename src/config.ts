import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-shhh-meter",
  description: "Classroom/library mic-level meter — teacher sees the class noise map in real time",
  accentHex: "#6ab04c",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
