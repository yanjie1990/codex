const POSITION_EPSILON = 0.05;

function roundToTenth(value) {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function computeCameraPosition({ xRot = 0, yRot = 0, zDist = 2 } = {}) {
  const normalizedXRot = normalizeNumber(xRot);
  const normalizedYRot = normalizeNumber(yRot);
  const normalizedZDist = normalizeNumber(zDist, 2);
  const xAngle = (normalizedXRot * Math.PI) / 180;
  const yAngle = (normalizedYRot * Math.PI) / 180;

  return {
    x: roundToTenth(normalizedZDist * Math.sin(yAngle) * Math.cos(xAngle)),
    y: roundToTenth(-normalizedZDist * Math.sin(xAngle)),
    z: roundToTenth(normalizedZDist * Math.cos(yAngle) * Math.cos(xAngle))
  };
}

function magnitude(value) {
  return Math.abs(value);
}

function isMeaningful(value) {
  return magnitude(value) > POSITION_EPSILON;
}

function dominantAxis(position) {
  const axes = [
    ['x', magnitude(position.x)],
    ['y', magnitude(position.y)],
    ['z', magnitude(position.z)]
  ];
  axes.sort((a, b) => b[1] - a[1]);
  return axes[0][1] > POSITION_EPSILON ? axes[0][0] : 'z';
}

function buildEnglishPrompt(position) {
  const axis = dominantAxis(position);
  const details = [];
  const constraints = [
    'Do not preserve the original camera angle, perspective, or framing.',
    'Preserve only the subject identity, outfit/materials, colors, and scene theme.'
  ];

  if (axis === 'y') {
    details.push(
      position.y > 0
        ? "Primary viewpoint: overhead top-down bird's-eye view from above, looking down at the subject."
        : "Primary viewpoint: low-angle worm's-eye view from below, looking up at the subject."
    );

    if (position.y > 0) {
      constraints.push(
        'The final image must show top-facing surfaces such as the top of the head, shoulders, hat, hair, object top, or ground/table plane around the subject.',
        'Avoid low-angle upward views, underside views, sky-dominant worm-eye compositions, and back-view framing unless rear view is the dominant requested axis.'
      );
    } else {
      constraints.push('The final image must look up from below and may show underside surfaces, not a top-down overhead view.');
    }

    if (isMeaningful(position.x)) {
      details.push(position.x > 0 ? 'The camera is slightly to the subject right.' : 'The camera is slightly to the subject left.');
    }

    details.push('Front/rear orientation is secondary because the camera is vertically above or below the subject.');
  } else if (axis === 'z') {
    details.push(
      position.z > 0
        ? 'Primary viewpoint: front-facing view from in front of the subject.'
        : 'Primary viewpoint: rear-facing view from behind the subject.'
    );

    if (isMeaningful(position.y)) {
      details.push(position.y > 0 ? 'The camera is also slightly above the subject.' : 'The camera is also slightly below the subject.');
    }
    if (isMeaningful(position.x)) {
      details.push(position.x > 0 ? 'The camera is also slightly to the subject right.' : 'The camera is also slightly to the subject left.');
    }
  } else {
    details.push(position.x > 0 ? 'Primary viewpoint: right-side view of the subject.' : 'Primary viewpoint: left-side view of the subject.');

    if (isMeaningful(position.y)) {
      details.push(position.y > 0 ? 'The camera is also slightly above the subject.' : 'The camera is also slightly below the subject.');
    }
    if (isMeaningful(position.z)) {
      details.push(position.z > 0 ? 'The camera is also slightly in front of the subject.' : 'The camera is also slightly behind the subject.');
    }
  }

  return `Camera position (${position.x}, ${position.y}, ${position.z}). Use this final computed camera position as the source of truth, not the raw slider signs. ${details.join(' ')} ${constraints.join(' ')} Reconstruct unseen surfaces plausibly when the original photo does not show them.`;
}

function buildChinesePrompt(position) {
  const axis = dominantAxis(position);
  const details = [];
  const constraints = [
    '不要保留原图的拍摄角度、透视关系和画面构图。',
    '只保留主体身份、服装/材质、颜色和场景主题。'
  ];

  if (axis === 'y') {
    details.push(position.y > 0 ? '主视角：相机在主体上方，从上往下拍摄，形成明确的顶部俯视/鸟瞰视角。' : '主视角：相机在主体下方，从下往上拍摄，形成明确的低角度仰视视角。');

    if (position.y > 0) {
      constraints.push(
        '最终画面必须看到头顶、肩部、帽子、头发、物体顶部或主体周围的地面/桌面等顶部可见面。',
        '避免低机位仰拍、从下往上看、天空占主导、只看背面或从背后仰拍的构图，除非背面是主导请求方向。'
      );
    } else {
      constraints.push('最终画面必须是从下往上看的低角度视角，可以看到底部结构，而不是顶部俯视。');
    }

    if (isMeaningful(position.x)) {
      details.push(position.x > 0 ? '相机同时略偏主体右侧。' : '相机同时略偏主体左侧。');
    }

    details.push('由于相机处在垂直方向，正面/背面不是主要视角。');
  } else if (axis === 'z') {
    details.push(position.z > 0 ? '主视角：相机在主体正面，输出正面视角。' : '主视角：相机在主体背面，输出背面视角。');

    if (isMeaningful(position.y)) {
      details.push(position.y > 0 ? '相机同时略高于主体。' : '相机同时略低于主体。');
    }
    if (isMeaningful(position.x)) {
      details.push(position.x > 0 ? '相机同时略偏主体右侧。' : '相机同时略偏主体左侧。');
    }
  } else {
    details.push(position.x > 0 ? '主视角：相机位于主体右侧，输出右侧视角。' : '主视角：相机位于主体左侧，输出左侧视角。');

    if (isMeaningful(position.y)) {
      details.push(position.y > 0 ? '相机同时略高于主体。' : '相机同时略低于主体。');
    }
    if (isMeaningful(position.z)) {
      details.push(position.z > 0 ? '相机同时略位于主体正面。' : '相机同时略位于主体背面。');
    }
  }

  return `相机位置坐标(${position.x}, ${position.y}, ${position.z})。请以这组最终计算出的相机位置作为唯一依据，不要直接按滑杆正负号推断视角。${details.join('')}${constraints.join('')}如果原图没有展示目标角度下的表面，请合理重建不可见部分。`;
}

export function buildAnglePrompt({ xRot = 0, yRot = 0, zDist = 2, locale = 'en' } = {}) {
  const position = computeCameraPosition({ xRot, yRot, zDist });
  return String(locale).startsWith('zh') ? buildChinesePrompt(position) : buildEnglishPrompt(position);
}
