# Runs PoseLandmarker over a video at `rate` samples/s; writes per-sample players: feet point, wrists and box (640x360 px).
# Usage: python3 pose.py video.webm out.json 10 [model]   (model defaults to ../../models/pose_full.task.wasm)
# In the cloud container mediapipe needs libEGL: point LD_LIBRARY_PATH at a folder with libEGL.so.1 / libGLESv2.so.2
# linked to Chromium's copies in /opt/pw-browsers/chromium-*/chrome-linux/.
import sys, json, cv2, time, os
import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision
video, out, rate = sys.argv[1], sys.argv[2], float(sys.argv[3])
model = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(__file__), '../../models/pose_full.task.wasm')
opts = vision.PoseLandmarkerOptions(base_options=mpp.BaseOptions(model_asset_path=model),
                                    running_mode=vision.RunningMode.VIDEO, num_poses=4, min_pose_detection_confidence=0.4, min_pose_presence_confidence=0.4)
lm = vision.PoseLandmarker.create_from_options(opts)
cap = cv2.VideoCapture(video); fps = 30; k = 0; nxt = 0; res = []; t0 = time.time(); n = 0
while True:
    ok, im = cap.read()
    if not ok: break
    t = k / fps; k += 1
    if t + 1e-6 < nxt: continue
    nxt += 1 / rate
    im = cv2.resize(im, (640, 360))
    r = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(im, cv2.COLOR_BGR2RGB)), int(t * 1000)); n += 1
    ps = []
    for p in r.pose_landmarks:
        L = lambda i: (p[i].x * 640, p[i].y * 360)
        feet = [L(i) for i in (27, 28, 29, 30, 31, 32)]
        fx = sum(f[0] for f in feet) / 6; fy = max(f[1] for f in feet)
        xs = [q.x * 640 for q in p]; ys = [q.y * 360 for q in p]
        ps.append({'feet': [round(fx, 1), round(fy, 1)], 'wr': [[round(c, 1) for c in L(15)], [round(c, 1) for c in L(16)]],
                   'box': [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))]})
    res.append([round(t, 3), ps])
json.dump(res, open(out, 'w'))
print('samples', n, 'sec/sample', round((time.time() - t0) / n, 3))
