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
  useRef,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Variants } from "motion/react";

export interface ReplyIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ReplyIconProps extends Omit<
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

const ReplyIcon = forwardRef<ReplyIconHandle, ReplyIconProps>(
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
    const isControlled = useRef(false);

    useImperativeHandle(ref, () => {
      isControlled.current = true;
      return {
        startAnimation: () => void controls.start(reduced ? "normal" : "animate"),
        stopAnimation: () => void controls.start("normal"),
      };
    }, [controls, reduced]);

    const handleEnter = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
      onMouseEnter?.(event);
      if (!isAnimated || reduced || isControlled.current) return;
      void controls.start("animate");
    }, [controls, isAnimated, onMouseEnter, reduced]);

    const handleLeave = useCallback((event: ReactMouseEvent<HTMLSpanElement>) => {
      onMouseLeave?.(event);
      if (!isControlled.current) void controls.start("normal");
    }, [controls, onMouseLeave]);

    const nudgeVariants: Variants = {
      normal: { x: 0 },
      animate: {
        x: [0, -2, 0.6, 0],
        transition: {
          duration: 0.6 * duration,
          ease: "easeInOut",
          times: [0, 0.35, 0.7, 1],
        },
      },
    };

    return (
      <LazyMotion features={domMin} strict>
        <m.span
          className={["reply-icon", className].filter(Boolean).join(" ")}
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
            <m.g variants={nudgeVariants}>
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
              <path d="m9 17-5-5 5-5" />
            </m.g>
          </m.svg>
        </m.span>
      </LazyMotion>
    );
  },
);

ReplyIcon.displayName = "ReplyIcon";

export { ReplyIcon };
