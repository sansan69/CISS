import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class GuardTrainingScreen extends StatelessWidget {
  const GuardTrainingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Training',
      subtitle: 'Modules and quizzes',
      children: <Widget>[
        SectionCard(
          title: 'Assigned Modules',
          subtitle:
              'Read PDFs, PPT-based content, and image modules from admin uploads.',
          icon: Icons.menu_book_rounded,
        ),
        SectionCard(
          title: 'Evaluations',
          subtitle: 'Attempt quizzes and review completion state.',
          icon: Icons.quiz_outlined,
        ),
      ],
    );
  }
}

