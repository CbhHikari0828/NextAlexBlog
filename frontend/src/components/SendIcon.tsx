import {
  LazyMotion,
  domMin,
  m,
  useAnimation,
  useReducedMotion,
} from "motion/react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Variants } from "motion/react";

export interface SendIconHandle {
  startAnimation: () => Promise<void>;
  stopAnimation: () => Promise<void>;
}

interface SendIconProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  | "color"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
> {
  size?: number;
  duration?: number;
  isAnimated?: boolean;
  color?: string;
}

const SendIcon = forwardRef<SendIconHandle, SendIconProps>(
  (
    {
      onMouseEnter,
      onMouseLeave,
      className,
      size = 24,
      duration = 1,
      isAnimated = true,
      color,
      ...props
    },
    ref,
  ) => {
    const controls = useAnimation();
    const reduced = useReducedMotion();

    const startAnimation = useCallback(() => controls.start(reduced ? "normal" : "animate"), [controls, reduced]);
    const stopAnimation = useCallback(() => controls.start("normal"), [controls]);

    useImperativeHandle(ref, () => ({ startAnimation, stopAnimation }), [startAnimation, stopAnimation]);

    const handleEnter = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
      onMouseEnter?.(event);
      if (isAnimated) void startAnimation();
    }, [isAnimated, onMouseEnter, startAnimation]);

    const handleLeave = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
      onMouseLeave?.(event);
    }, [onMouseLeave]);

    const planeVariants: Variants = {
      normal: { x: 0, y: 0, opacity: 1 },
      animate: {
        x: [0, 12, -12, 0],
        y: [0, -12, 12, 0],
        opacity: [1, 0, 0, 1],
        transition: {
          duration: 0.9 * duration,
          ease: ["easeIn", "easeInOut", "easeOut"],
          times: [0, 0.4, 0.45, 1],
        },
      },
    };

    return (
      <LazyMotion features={domMin} strict>
        <m.span
          className={["send-icon", className].filter(Boolean).join(" ")}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          {...props}
          style={{ color, ...props.style }}
        >
          <m.svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={controls}
            initial="normal"
          >
            <m.g variants={planeVariants}>
              <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
              <path d="m21.854 2.147-10.94 10.939" />
            </m.g>
          </m.svg>
        </m.span>
      </LazyMotion>
    );
  },
);

SendIcon.displayName = "SendIcon";

export { SendIcon };
