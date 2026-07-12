import { useAnimations, useGLTF } from '@react-three/drei';
import { useEffect } from 'react';
import type { Group } from 'three';

export function RiggedAvatar({
  url,
  clip = 'ANIM_IDLE_001',
  ...props
}: { url: string; clip?: string } & JSX.IntrinsicElements['group']) {
  const { scene, animations } = useGLTF(url);
  const { actions } = useAnimations(animations, scene as Group);
  useEffect(() => {
    const action = actions[clip];
    action?.reset().fadeIn(0.18).play();
    return () => { action?.fadeOut(0.18); };
  }, [actions, clip]);
  return <primitive object={scene} {...props} />;
}
