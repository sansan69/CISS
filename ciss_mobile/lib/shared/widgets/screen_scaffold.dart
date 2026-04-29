import 'package:flutter/material.dart';

class ScreenScaffold extends StatelessWidget {
  const ScreenScaffold({
    super.key,
    required this.title,
    required this.children,
    this.subtitle,
    this.actions = const <Widget>[],
  });

  final String title;
  final String? subtitle;
  final List<Widget> children;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title),
            if (subtitle != null)
              Text(
                subtitle!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
          ],
        ),
        actions: actions,
      ),
      body: ListView.separated(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
        itemBuilder: (BuildContext context, int index) => children[index],
        separatorBuilder: (_, int index) => const SizedBox(height: 14),
        itemCount: children.length,
      ),
    );
  }
}
