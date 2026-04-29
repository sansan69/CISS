import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class GuardEvaluationsScreen extends StatelessWidget {
  const GuardEvaluationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Evaluations',
      subtitle: 'Quiz results and performance',
      children: <Widget>[
        SectionCard(
          title: 'Assigned Evaluations',
          subtitle: 'Review active quizzes and completed scores.',
          icon: Icons.workspace_premium_outlined,
        ),
      ],
    );
  }
}

