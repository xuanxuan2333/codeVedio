from manim import *

class Sample(Scene):
    def construct(self):
        self.camera.background_color = "#0b0d12"

        box = RoundedRectangle(
            corner_radius=0.22, width=3.4, height=2.2,
            stroke_color=BLUE, stroke_width=5,
            fill_color=BLUE, fill_opacity=0.15,
        ).move_to(LEFT * 3.4)

        # 1. 平移
        self.play(box.animate.move_to(ORIGIN), run_time=1.5, rate_func=smooth)
        # 2. 旋转
        self.play(Rotate(box, angle=PI / 4), run_time=1.0, rate_func=smooth)
        # 3. 缩放
        self.play(box.animate.scale(1.35), run_time=1.0, rate_func=smooth)
        # 4. 变色 + 字幕
        label = Text("translate → rotate → scale", font_size=30, color=WHITE)
        label.to_edge(DOWN, buff=0.55)
        self.play(
            box.animate.set_stroke_color(PURPLE).set_fill(PURPLE, opacity=0.25),
            FadeIn(label, shift=UP * 0.2),
            run_time=0.9,
        )
        self.wait(0.15)
