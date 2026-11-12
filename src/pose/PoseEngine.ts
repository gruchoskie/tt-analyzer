import type { Landmark } from './types';

/**
 * MediaPipe Pose Landmarker (modelo "lite", até 2 pessoas) no navegador.
 * O runtime WASM e o modelo vêm do próprio app (pastas mediapipe/ e models/),
 * baixados só quando a pose é ligada e guardados para uso offline.
 */
export interface DetectedPose {
  image: Landmark[];
  world: Landmark[];
}

type Landmarker = {
  detectForVideo(v: HTMLVideoElement, t: number): { landmarks: Landmark[][]; worldLandmarks: Landmark[][] };
  close(): void;
};

export class PoseEngine {
  private lastT = 0;
  private constructor(
    private readonly lm: Landmarker,
    readonly delegate: 'GPU' | 'CPU',
  ) {}

  static async create(numPoses = 2): Promise<PoseEngine> {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const base = new URL('./', document.baseURI).href;
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`);
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}models/pose_landmarker_lite.task`, delegate },
        runningMode: 'VIDEO',
        numPoses,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      return new PoseEngine((await make('GPU')) as unknown as Landmarker, 'GPU');
    } catch {
      return new PoseEngine((await make('CPU')) as unknown as Landmarker, 'CPU');
    }
  }

  detect(video: HTMLVideoElement): DetectedPose[] {
    // o MediaPipe exige instantes crescentes
    const t = Math.max(performance.now(), this.lastT + 1);
    this.lastT = t;
    const r = this.lm.detectForVideo(video, t);
    return r.landmarks.map((image, i) => ({ image, world: r.worldLandmarks[i] ?? [] }));
  }

  close(): void {
    this.lm.close();
  }
}
