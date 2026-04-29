import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class GuardLeaveScreen extends StatelessWidget {
  const GuardLeaveScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Leave',
      subtitle: 'Apply and track leave requests',
      children: <Widget>[
        SectionCard(
          title: 'New Leave Request',
          subtitle: 'Choose dates, reason, and submit for review.',
          icon: Icons.add_task_rounded,
        ),
        SectionCard(
          title: 'Leave History',
          subtitle: 'Pending, approved, rejected, and past leave records.',
          icon: Icons.calendar_month_rounded,
        ),
      ],
    );
  }
}

