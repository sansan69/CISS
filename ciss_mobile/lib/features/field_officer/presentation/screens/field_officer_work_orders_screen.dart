import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class FieldOfficerWorkOrdersScreen extends StatelessWidget {
  const FieldOfficerWorkOrdersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Work Orders',
      subtitle: 'District duty coverage',
      children: <Widget>[
        SectionCard(
          title: 'Upcoming Exam Duties',
          subtitle:
              'Center date groups, combined counts, and assignment status.',
          icon: Icons.event_note_outlined,
        ),
      ],
    );
  }
}

